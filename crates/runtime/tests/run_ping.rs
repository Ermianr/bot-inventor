//! The Ping bot, from the folder on disk to the reply the mock platform records.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::path::Path;

use common::*;
use graph::{Payload, Project};
use runtime::platform::{AllowedMentions, Delivery};
use runtime::run::Dispatch;
use serde_json::json;

#[tokio::test]
async fn ping_loads_from_the_folder_compiles_and_replies() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../graph/tests/samples/v1/ping");
    let loaded = Project::load(&dir).unwrap();
    let report = run(&loaded.project);
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);

    // The runner's path: the payload is written and read back before it runs.
    let bytes = report.payload.unwrap().encode().unwrap();
    let payload = Payload::decode(&bytes).unwrap();

    let (runtime, log) = start(&payload);
    let sent = dispatch_and_wait(&runtime, command("ping")).await;

    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].content, "Pong!");
    assert_eq!(sent[0].interaction.id, "i-1");
    assert_eq!(sent[0].delivery, Delivery::Response);
    assert!(!sent[0].ephemeral);
    assert_eq!(sent[0].mentions, AllowedMentions::default());
    assert!(log.records().is_empty());
}

#[tokio::test]
async fn a_command_with_no_flow_starts_nothing() {
    let (runtime, log) = start(&payload(&ping()));
    let result = runtime.dispatch(command("other"));
    assert_eq!(result, Dispatch::default());
    runtime.drain().await;
    assert!(replies(&runtime).is_empty());
    assert!(log.records().is_empty());
}

#[tokio::test]
async fn the_command_decides_which_flow_runs() {
    let project = project(vec![
        (
            "a",
            flow(
                vec![slash("n1", "s", "one"), reply("n2", "r", "first")],
                vec![line("n1", "next", "n2")],
            ),
        ),
        (
            "b",
            flow(
                vec![slash("m1", "s", "two"), reply("m2", "r", "second")],
                vec![line("m1", "next", "m2")],
            ),
        ),
    ]);
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("two")).await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].content, "second");
}

#[tokio::test]
async fn the_command_node_sets_the_visibility_of_the_replies() {
    let mut project = ping();
    project.flows.values_mut().next().unwrap().nodes[0]
        .settings
        .insert("ephemeral".to_owned(), json!(true));
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("ping")).await;
    assert!(sent[0].ephemeral);
}

#[tokio::test]
async fn the_second_reply_is_a_follow_up() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "first", "one"),
            reply("n3", "second", "two"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    let delivery: Vec<_> = sent.iter().map(|reply| reply.delivery).collect();
    assert_eq!(delivery, [Delivery::Response, Delivery::FollowUp]);
}

#[tokio::test]
async fn a_template_reads_the_event_and_the_steps_before_it() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "first", "Hi {{ event.user.name }}"),
            reply(
                "n3",
                "second",
                "{{ steps.first.message_id }} / {{ event.user.id }}",
            ),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(sent[0].content, "Hi ana");
    assert_eq!(sent[1].content, "mock-1 / 42");
}

#[tokio::test]
async fn text_from_a_user_is_inserted_and_never_evaluated() {
    let project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "r", "You wrote: {{ event.options.text }}"),
        ],
        vec![line("n1", "next", "n2")],
    );
    let mut project = project;
    project.flows.values_mut().next().unwrap().nodes[0]
        .settings
        .insert(
            "options".to_owned(),
            json!([{ "name": "text", "description": "Some text", "type": "string" }]),
        );
    let (runtime, log) = start(&payload(&project));
    let mut event = command("go");
    event.data["options"] = json!({ "text": "{{ 1 + 1 }} {{ event.user.id }}" });
    let sent = dispatch_and_wait(&runtime, event).await;
    assert_eq!(
        sent[0].content,
        "You wrote: {{ 1 + 1 }} {{ event.user.id }}"
    );
    assert!(log.records().is_empty());
}

#[tokio::test]
async fn declared_variables_read_their_initial_value() {
    use graph::{VariableScope, VariableType};
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "r", "{{ vars.bot.greeting }}"),
        ],
        vec![line("n1", "next", "n2")],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "greeting",
        VariableType::Text,
        json!("hello"),
    );
    let (runtime, _) = start(&payload(&project));
    let sent = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(sent[0].content, "hello");
}
