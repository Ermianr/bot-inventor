//! The limits that stop a runaway bot.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::time::Duration;

use common::*;
use runtime::platform::MockPlatform;
use runtime::run::{GENERIC_FAILURE_MESSAGE, Level, Limits, Runtime};

#[tokio::test]
async fn a_run_may_take_the_steps_of_the_limit_and_no_more() {
    let (runtime, log) = start(&payload(&chain(500)));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(sent.len(), 499);
    assert!(log.records().is_empty());

    let (runtime, log) = start(&payload(&chain(501)));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(sent.len(), 499, "the 501st node does not run");
    let records = log.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].level, Level::Warn);
    assert_eq!(records[0].flow.as_deref(), Some("main"));
    assert_eq!(records[0].node.as_deref(), Some("n500"));
    assert!(records[0].message.contains("500 steps"));
}

#[tokio::test]
async fn a_run_stopped_before_any_response_sends_the_generic_message() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            branch("n2", "a", "true"),
            branch("n3", "b", "true"),
            branch("n4", "c", "true"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n3", "true", "n4"),
        ],
    );
    let limits = Limits {
        max_steps: 3,
        ..Limits::default()
    };
    let (runtime, log) = start_with(&payload(&project), limits);
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].content, GENERIC_FAILURE_MESSAGE);
    assert_eq!(log.records().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_run_is_stopped_when_it_takes_too_long() {
    let limits = Limits {
        max_duration: Duration::from_secs(1),
        ..Limits::default()
    };
    let (runtime, log) = start_with(&payload(&ping()), limits);
    runtime.platform().set_delay(Duration::from_secs(2));
    let sent = dispatch_and_wait(&runtime, command("ping")).await;

    // The reply of the flow was cancelled; the generic message is what the user gets.
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].content, GENERIC_FAILURE_MESSAGE);
    let records = log.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].level, Level::Warn);
    assert_eq!(records[0].node.as_deref(), Some("n2"));
    assert!(records[0].message.contains("1 seconds"));
}

#[tokio::test(start_paused = true)]
async fn events_past_the_cap_of_simultaneous_runs_are_dropped() {
    let limits = Limits {
        max_runs: 2,
        ..Limits::default()
    };
    let (runtime, log) = start_with(&payload(&ping()), limits);
    runtime.platform().set_delay(Duration::from_secs(10));

    let results: Vec<_> = (0..3).map(|_| runtime.dispatch(command("ping"))).collect();
    let started: Vec<_> = results.iter().map(|r| r.started).collect();
    let dropped: Vec<_> = results.iter().map(|r| r.dropped).collect();
    assert_eq!(started, [1, 1, 0]);
    assert_eq!(dropped, [0, 0, 1]);

    let records = log.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].level, Level::Warn);
    assert_eq!(records[0].flow.as_deref(), Some("main"));

    runtime.drain().await;
    assert_eq!(runtime.platform().actions().len(), 2);

    // The runs ended, so their places are free again.
    assert_eq!(runtime.dispatch(command("ping")).started, 1);
    runtime.drain().await;
    assert_eq!(runtime.platform().actions().len(), 3);
}

#[test]
fn the_largest_flow_runs_on_a_small_stack() {
    let payload = payload(&chain(graph_limit()));
    let handle = std::thread::Builder::new()
        .stack_size(512 * 1024)
        .spawn(move || {
            let limits = Limits {
                max_steps: 5000,
                ..Limits::default()
            };
            let (runtime, log) = start_with(&payload, limits);
            let tokio = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap();
            let sent = tokio.block_on(dispatch_and_wait(&runtime, command("go")));
            (sent.len(), log.records().len())
        })
        .unwrap();
    assert_eq!(handle.join().unwrap(), (graph_limit() - 1, 0));
}

fn graph_limit() -> usize {
    runtime::compile::MAX_FLOW_NODES
}

#[test]
fn a_runtime_must_allow_a_run() {
    let limits = Limits {
        max_runs: 0,
        ..Limits::default()
    };
    let result = Runtime::with(
        &payload(&ping()),
        MockPlatform::new(),
        std::sync::Arc::new(runtime::run::NoLog),
        &runtime::expr::CelEngine::new(),
        limits,
    );
    assert!(result.is_err());
}
