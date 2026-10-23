//! Ports, error paths and the order a run follows.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use runtime::platform::PlatformError;
use runtime::run::{GENERIC_FAILURE_MESSAGE, Level};

fn contents(replies: &[runtime::platform::Reply]) -> Vec<&str> {
    replies.iter().map(|reply| reply.content.as_str()).collect()
}

/// `slash -> branch(condition)`, `true` to a reply "yes" and `false` to a reply "no".
fn branching(condition: &str) -> Project {
    single(
        vec![
            slash("n1", "s", "go"),
            branch("n2", "check", condition),
            reply("n3", "yes", "yes"),
            reply("n4", "no", "no"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n2", "false", "n4"),
        ],
    )
}

use graph::Project;

#[tokio::test]
async fn a_branch_follows_true_or_false() {
    for (condition, expected) in [
        ("event.user.name == 'ana'", "yes"),
        ("event.user.name == 'bob'", "no"),
    ] {
        let (runtime, _) = start(&payload(&branching(condition)));
        let sent = dispatch_and_wait(&runtime, command("go")).await;
        assert_eq!(contents(&sent), [expected], "{condition}");
    }
}

#[tokio::test]
async fn a_run_ends_when_the_port_has_no_line() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            branch("n2", "check", "false"),
            reply("n3", "yes", "yes"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "true", "n3")],
    );
    let (runtime, log) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert!(sent.is_empty());
    assert!(log.records().is_empty());
}

#[tokio::test]
async fn a_node_runs_once_after_every_node_before_it() {
    // go -> a, go -> b, a -> c, b -> c: c runs once, after a and b.
    let project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "a", "a"),
            reply("n3", "b", "b"),
            reply(
                "n4",
                "c",
                "c {{ steps.a.message_id }} {{ steps.b.message_id }}",
            ),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n1", "next", "n3"),
            line("n2", "next", "n4"),
            line("n3", "next", "n4"),
        ],
    );
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(contents(&sent), ["a", "b", "c mock-1 mock-2"]);
}

/// `slash -> reply(first)`, whose `error` port leads to a reply that shows the error.
fn with_error_path() -> Project {
    single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "first", "work"),
            reply("n3", "handler", "failed: {{ error.kind }}"),
            reply("n4", "after", "later: {{ error.kind }}"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "error", "n3"),
            line("n3", "next", "n4"),
        ],
    )
}

#[tokio::test]
async fn a_failed_action_follows_the_error_port_with_its_kind() {
    for (error, kind) in [
        (PlatformError::MissingPermissions, "missing_permissions"),
        (PlatformError::Failed, "platform"),
    ] {
        let (runtime, log) = start(&payload(&with_error_path()));
        runtime.platform().fail_next(error);
        let sent = dispatch_and_wait(&runtime, command("go")).await;
        // The failed reply sent nothing, so the handler's reply is the response, and the error
        // is still readable further down the path.
        assert_eq!(
            contents(&sent),
            [format!("failed: {kind}"), format!("later: {kind}")]
        );
        assert!(log.records().is_empty());
    }
}

#[tokio::test]
async fn the_error_message_is_readable_on_the_error_path() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            branch("n2", "check", "'text'"),
            reply("n3", "handler", "{{ error.kind }}: {{ error.message }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "error", "n3")],
    );
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(
        contents(&sent),
        ["invalid_value: `condition` must give true or false"]
    );
}

#[tokio::test]
async fn a_failure_with_no_error_path_is_logged_and_the_user_gets_a_generic_message() {
    let (runtime, log) = start(&payload(&ping()));
    runtime.platform().fail_next(PlatformError::Failed);
    let sent = dispatch_and_wait(&runtime, command("ping")).await;

    assert_eq!(contents(&sent), [GENERIC_FAILURE_MESSAGE]);
    assert!(sent[0].ephemeral);

    let records = log.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].level, Level::Error);
    assert_eq!(records[0].flow.as_deref(), Some("main"));
    assert_eq!(records[0].node.as_deref(), Some("n2"));
    assert!(records[0].message.contains("platform"), "{records:?}");
    // The detail stays in the log.
    assert!(!sent[0].content.contains("platform"));
}

#[tokio::test]
async fn a_failure_after_the_response_only_writes_the_log() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "first", "one"),
            branch("n3", "check", "'text'"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    let (runtime, log) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(contents(&sent), ["one"]);
    assert_eq!(log.records().len(), 1);
}

#[tokio::test]
async fn an_event_with_no_interaction_cannot_be_answered() {
    let (runtime, log) = start(&payload(&ping()));
    let mut event = command("ping");
    event.interaction = None;
    let sent = dispatch_and_wait(&runtime, event).await;
    assert!(sent.is_empty());
    assert_eq!(log.records().len(), 1);
}
