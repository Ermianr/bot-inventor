//! Payloads and events that are wrong: an error, never a panic. The payloads here skip compile,
//! as a damaged or hand-written one would.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::sync::Arc;

use common::*;
use graph::{Expression, Payload};
use proptest::prelude::*;
use runtime::platform::MockPlatform;
use runtime::run::{GENERIC_FAILURE_MESSAGE, Level, NoLog, Runtime, RuntimeError};
use serde_json::{Value, json};

/// A payload where `change` has been applied to the Ping bot.
fn ping_with(change: impl FnOnce(&mut Payload)) -> Payload {
    let mut payload = payload(&ping());
    change(&mut payload);
    payload
}

fn build(payload: &Payload) -> Result<Runtime<MockPlatform>, RuntimeError> {
    Runtime::new(payload, MockPlatform::new(), Arc::new(NoLog))
}

/// Runs the payload and checks the run failed in the way a bad node does: one error in the log
/// and the generic message for the user.
async fn fails_cleanly(payload: &Payload, message_part: &str) {
    let (runtime, log) = start(payload);
    let sent = dispatch_and_wait(&runtime, command("ping")).await;
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].content, GENERIC_FAILURE_MESSAGE);
    let records = log.records();
    assert_eq!(records.len(), 1, "{records:?}");
    assert_eq!(records[0].level, Level::Error);
    assert!(
        records[0].message.contains(message_part),
        "{message_part}: {records:?}"
    );
}

// ---- discord.reply ----------------------------------------------------------------------------

#[tokio::test]
async fn reply_with_a_missing_content() {
    let payload = ping_with(|p| {
        p.flows[0].nodes[1].settings.remove("content");
    });
    fails_cleanly(&payload, "`content` is missing").await;
}

#[tokio::test]
async fn reply_with_a_content_that_is_not_text() {
    for wrong in [
        json!(7),
        json!(null),
        json!(["a"]),
        json!({"a": 1}),
        json!(true),
    ] {
        let payload = ping_with(|p| {
            p.flows[0].nodes[1].settings.insert("content".into(), wrong);
        });
        fails_cleanly(&payload, "`content` must be text").await;
    }
}

#[tokio::test]
async fn reply_with_a_content_out_of_range() {
    for content in [String::new(), "a".repeat(2001)] {
        let payload = ping_with(|p| {
            p.flows[0].nodes[1]
                .settings
                .insert("content".into(), Value::String(content));
        });
        fails_cleanly(&payload, "1 to 2000 characters").await;
    }
}

#[tokio::test]
async fn reply_with_a_template_that_renders_too_much_or_nothing_usable() {
    for (source, part) in [
        ("{{ event.user }}", "a list or a map"),
        ("{{ event.missing }}", "evaluation failed"),
        ("{{ 'a' * 3 }}", "evaluation failed"),
    ] {
        let payload = ping_with(|p| {
            p.flows[0].nodes[1].expressions.push(Expression {
                path: "content".into(),
                source: source.into(),
            });
        });
        fails_cleanly(&payload, part).await;
    }
}

// ---- discord.slash_command --------------------------------------------------------------------

#[tokio::test]
async fn slash_command_with_an_ephemeral_that_is_not_a_boolean() {
    for wrong in [json!("yes"), json!(1), json!(null)] {
        let payload = ping_with(|p| {
            p.flows[0].nodes[0]
                .settings
                .insert("ephemeral".into(), wrong);
        });
        fails_cleanly(&payload, "`ephemeral` must be true or false").await;
    }
}

// ---- logic.branch -----------------------------------------------------------------------------

fn branch_payload(change: impl FnOnce(&mut Payload)) -> Payload {
    let project = single(
        vec![
            slash("n1", "s", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "yes", "yes"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "true", "n3")],
    );
    let mut payload = payload(&project);
    change(&mut payload);
    payload
}

#[tokio::test]
async fn branch_without_a_condition() {
    let payload = branch_payload(|p| p.flows[0].nodes[1].expressions.clear());
    fails_cleanly(&payload, "`condition` is missing").await;
}

#[tokio::test]
async fn branch_whose_condition_is_not_true_or_false() {
    for source in ["1", "'text'", "[true]", "{'a': true}", "null"] {
        let payload = branch_payload(|p| {
            p.flows[0].nodes[1].expressions[0].source = source.into();
        });
        fails_cleanly(&payload, "must give true or false").await;
    }
}

#[tokio::test]
async fn branch_whose_condition_fails_to_evaluate() {
    for source in [
        "event.missing.deep",
        "event.user.name + 1",
        "1 / 0",
        "[1][5] == 1",
    ] {
        let payload = branch_payload(|p| {
            p.flows[0].nodes[1].expressions[0].source = source.into();
        });
        fails_cleanly(&payload, "expression").await;
    }
}

// ---- The payload itself -----------------------------------------------------------------------

#[test]
fn a_payload_with_a_node_the_runtime_does_not_know() {
    for change in [
        (|p: &mut Payload| p.flows[0].nodes[1].kind = "discord.nothing".into()) as fn(&mut Payload),
        |p| p.flows[0].nodes[1].type_version = 9,
    ] {
        let result = build(&ping_with(change));
        assert!(matches!(result, Err(RuntimeError::UnknownNode { .. })));
    }
}

#[test]
fn a_payload_with_a_bad_expression() {
    for (path, source) in [
        ("content", "{{ 1 +"),
        ("content", "{{ nothing.here }}"),
        ("content", "{{ unknown_function(1) }}"),
        ("no_such_setting", "'x'"),
        ("name", "'x'"),
    ] {
        let node = if path == "name" { 0 } else { 1 };
        let payload = ping_with(|p| {
            p.flows[0].nodes[node].expressions.push(Expression {
                path: path.into(),
                source: source.into(),
            });
        });
        let result = build(&payload);
        assert!(
            matches!(result, Err(RuntimeError::BadExpression { .. })),
            "{path}: {source}"
        );
    }
}

#[test]
fn a_payload_whose_trigger_is_not_a_trigger() {
    let result = build(&ping_with(|p| p.flows[0].trigger = 1));
    assert!(matches!(result, Err(RuntimeError::NotATrigger { .. })));
}

#[test]
fn an_error_message_names_the_place_and_never_a_value() {
    let payload = ping_with(|p| {
        p.flows[0].nodes[1].expressions.push(Expression {
            path: "content".into(),
            source: "{{ 1 +".into(),
        });
    });
    let message = build(&payload).err().unwrap().to_string();
    assert!(
        message.contains("flow `main`, node `n2`, `content`"),
        "{message}"
    );
}

#[tokio::test]
async fn a_payload_with_a_line_that_goes_back_ends() {
    // Payload::check accepts it (the index is in range); the run still ends.
    let payload = ping_with(|p| {
        p.flows[0].nodes[1].next.push(graph::Output {
            port: graph::PortName::parse("next").unwrap(),
            to: vec![0],
        });
    });
    let (runtime, _) = start(&payload);
    let sent = dispatch_and_wait(&runtime, command("ping")).await;
    assert_eq!(sent.len(), 1);
}

// ---- Events -----------------------------------------------------------------------------------

#[tokio::test]
async fn an_event_that_is_too_large_for_an_expression_is_an_error() {
    let payload = branch_payload(|_| {});
    let (runtime, log) = start(&payload);
    let mut event = command("ping");
    event.data = json!({ "text": "a".repeat(runtime::expr::MAX_SCOPE_BYTES + 1) });
    let sent = dispatch_and_wait(&runtime, event).await;
    // The scope is refused when the branch is about to read it; the user hears a generic message.
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].content, GENERIC_FAILURE_MESSAGE);
    assert_eq!(log.records().len(), 1);
}

#[tokio::test]
async fn events_of_an_unknown_kind_or_without_a_command_start_nothing() {
    let (runtime, log) = start(&payload(&ping()));
    let mut unknown = command("ping");
    unknown.kind = "nothing".into();
    let mut nameless = command("ping");
    nameless.command = None;
    for event in [unknown, nameless] {
        assert_eq!(runtime.dispatch(event).started, 0);
    }
    runtime.drain().await;
    assert!(log.records().is_empty());
}

#[test]
fn dispatching_outside_an_async_runtime_drops_the_event() {
    let (runtime, log) = start(&payload(&ping()));
    let result = runtime.dispatch(command("ping"));
    assert_eq!(result.started, 0);
    assert_eq!(log.records().len(), 1);
}

fn json_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        any::<i64>().prop_map(|n| json!(n)),
        any::<f64>().prop_map(|n| json!(n)),
        "\\PC{0,30}".prop_map(Value::String),
    ];
    leaf.prop_recursive(4, 64, 6, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..6).prop_map(Value::Array),
            prop::collection::btree_map("\\PC{0,8}", inner, 0..6)
                .prop_map(|map| Value::Object(map.into_iter().collect())),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Whatever an event holds, a run ends and nothing panics.
    #[test]
    fn arbitrary_events_never_panic(data in json_value()) {
        let project = single(
            vec![
                slash("n1", "s", "ping"),
                branch("n2", "check", "event.user.name == 'ana'"),
                reply("n3", "yes", "{{ event.user.name }}"),
                reply("n4", "no", "no"),
            ],
            vec![
                line("n1", "next", "n2"),
                line("n2", "true", "n3"),
                line("n2", "false", "n4"),
            ],
        );
        let tokio = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        tokio.block_on(async {
            let (runtime, _) = start(&payload(&project));
            let mut event = command("ping");
            event.data = data;
            runtime.dispatch(event);
            runtime.drain().await;
        });
    }
}
