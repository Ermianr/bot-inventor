//! Renaming a node rewrites the reads of its alias, found by parsing and not by searching text.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::{FlowName, NodeId, Project};
use runtime::catalog::Registry;
use runtime::compile::Code;
use runtime::expr::CelEngine;
use runtime::rename::{RenameError, Renamed, rename_alias};
use serde_json::json;

fn rename(project: &Project, flow: &str, node: &str, alias: &str) -> Result<Renamed, RenameError> {
    rename_alias(
        &Registry::builtin(),
        &CelEngine::new(),
        project,
        &FlowName::parse(flow).unwrap(),
        &NodeId::parse(node).unwrap(),
        alias,
    )
}

fn setting(project: &Project, flow: &str, node: &str, field: &str) -> String {
    let flow = &project.flows[&FlowName::parse(flow).unwrap()];
    let node = flow.nodes.iter().find(|n| n.id.as_str() == node).unwrap();
    node.settings[field].as_str().unwrap().to_owned()
}

fn alias(project: &Project, flow: &str, node: &str) -> String {
    let flow = &project.flows[&FlowName::parse(flow).unwrap()];
    flow.nodes
        .iter()
        .find(|n| n.id.as_str() == node)
        .unwrap()
        .alias
        .to_string()
}

/// `first` replies, `check` reads it, `done` reads it in a template. A second flow has its own
/// `first`.
fn bot() -> Project {
    project(vec![
        (
            "main",
            flow(
                vec![
                    slash("n1", "cmd", "ping"),
                    reply("n2", "first", "hello"),
                    branch(
                        "n3",
                        "check",
                        "steps.first.message_id != 'steps.first.message_id' && steps.first.message_id != ''",
                    ),
                    reply(
                        "n4",
                        "done",
                        "see steps.first.message_id: {{ steps.first.message_id }} / {{ steps.cmd_x_first.y }}",
                    ),
                ],
                vec![
                    line("n1", "next", "n2"),
                    line("n2", "next", "n3"),
                    line("n3", "true", "n4"),
                ],
            ),
        ),
        (
            "other",
            flow(
                vec![
                    slash("m1", "cmd", "pong"),
                    reply("m2", "first", "hello"),
                    branch("m3", "check", "steps.first.message_id != ''"),
                ],
                vec![line("m1", "next", "m2"), line("m2", "next", "m3")],
            ),
        ),
    ])
}

#[test]
fn the_alias_and_every_read_of_it_change_together() {
    let before = bot();
    let renamed = rename(&before, "main", "n2", "greeting").unwrap();
    let after = &renamed.project;
    assert_eq!(alias(after, "main", "n2"), "greeting");
    assert_eq!(
        setting(after, "main", "n3", "condition"),
        "steps.greeting.message_id != 'steps.first.message_id' && steps.greeting.message_id != ''"
    );
    assert_eq!(
        setting(after, "main", "n4", "content"),
        "see steps.first.message_id: {{ steps.greeting.message_id }} / {{ steps.cmd_x_first.y }}"
    );
    assert_eq!(renamed.left_alone, []);
    let fields: Vec<_> = renamed
        .rewritten
        .iter()
        .map(|f| (f.node.as_str(), f.path.as_str()))
        .collect();
    assert_eq!(fields, [("n3", "condition"), ("n4", "content")]);
}

#[test]
fn a_renamed_project_compiles_like_the_original() {
    // The unknown step in the second segment keeps its error before and after.
    let before = bot();
    let renamed = rename(&before, "main", "n2", "greeting").unwrap().project;
    let codes_before: Vec<_> = run(&before)
        .diagnostics
        .iter()
        .map(|d| (d.code, d.path.clone()))
        .collect();
    let codes_after: Vec<_> = run(&renamed)
        .diagnostics
        .iter()
        .map(|d| (d.code, d.path.clone()))
        .collect();
    assert_eq!(codes_before, codes_after);
    assert_eq!(
        codes_after.len(),
        1,
        "only the read of a step that never existed"
    );
}

#[test]
fn only_the_flow_of_the_node_is_touched() {
    let renamed = rename(&bot(), "main", "n2", "greeting").unwrap().project;
    assert_eq!(alias(&renamed, "other", "m2"), "first");
    assert_eq!(
        setting(&renamed, "other", "m3", "condition"),
        "steps.first.message_id != ''"
    );
    assert_eq!(renamed.manifest, bot().manifest);
}

#[test]
fn a_clean_project_stays_clean_and_a_broken_read_is_reported_by_compile() {
    let mut clean = bot();
    // Drop the unknown step so the project has no diagnostics at all.
    let flow = clean
        .flows
        .get_mut(&FlowName::parse("main").unwrap())
        .unwrap();
    flow.nodes[3]
        .settings
        .insert("content".to_owned(), json!("{{ steps.first.message_id }}"));
    assert!(run(&clean).diagnostics.is_empty());
    let renamed = rename(&clean, "main", "n2", "greeting").unwrap().project;
    assert!(run(&renamed).diagnostics.is_empty());
}

#[test]
fn what_cannot_be_renamed_is_refused_and_changes_nothing() {
    let project = bot();
    let copy = project.clone();
    assert_eq!(
        rename(&project, "main", "n2", "check").unwrap_err(),
        RenameError::AliasTaken
    );
    for bad in [
        "",
        "Greeting",
        "has space",
        "1abc",
        "a-b",
        "a.b",
        &"a".repeat(65),
    ] {
        assert!(
            matches!(
                rename(&project, "main", "n2", bad),
                Err(RenameError::InvalidAlias(_))
            ),
            "{bad:?}"
        );
    }
    assert_eq!(
        rename(&project, "nope", "n2", "x").unwrap_err(),
        RenameError::UnknownFlow
    );
    assert_eq!(
        rename(&project, "main", "zz", "x").unwrap_err(),
        RenameError::UnknownNode
    );
    assert_eq!(project, copy);
}

#[test]
fn the_same_alias_is_no_change() {
    let project = bot();
    let renamed = rename(&project, "main", "n2", "first").unwrap();
    assert_eq!(renamed.project, project);
    assert!(renamed.rewritten.is_empty() && renamed.left_alone.is_empty());
}

#[test]
fn an_expression_that_does_not_compile_is_left_alone_and_reported() {
    let mut project = bot();
    let flow = project
        .flows
        .get_mut(&FlowName::parse("main").unwrap())
        .unwrap();
    flow.nodes[2]
        .settings
        .insert("condition".to_owned(), json!("steps.first.message_id == "));
    let renamed = rename(&project, "main", "n2", "greeting").unwrap();
    assert_eq!(alias(&renamed.project, "main", "n2"), "greeting");
    assert_eq!(
        setting(&renamed.project, "main", "n3", "condition"),
        "steps.first.message_id == "
    );
    assert_eq!(renamed.left_alone.len(), 1);
    assert_eq!(renamed.left_alone[0].field.node.as_str(), "n3");
    assert_eq!(renamed.left_alone[0].field.path, "condition");
    // The read that was left is the one compile will mark.
    let report = run(&renamed.project);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.path.as_deref() == Some("condition"))
    );
    // The template in the other node was still rewritten.
    assert!(
        setting(&renamed.project, "main", "n4", "content")
            .contains("{{ steps.greeting.message_id }}")
    );
}

#[test]
fn a_text_that_would_grow_past_its_limit_is_left_alone() {
    let mut project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "a", "x"),
            reply(
                "n3",
                "b",
                &format!("{{{{steps.a.message_id}}}}{}", "x".repeat(2000 - 22)),
            ),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    assert!(run(&project).diagnostics.is_empty());
    let long = "z".repeat(64);
    let renamed = rename(&project, "main", "n2", &long).unwrap();
    assert_eq!(renamed.left_alone.len(), 1);
    assert!(renamed.left_alone[0].reason.contains("2000"));
    // A rename that fits is rewritten.
    project = renamed.project;
    assert_eq!(alias(&project, "main", "n2"), long);
    assert!(
        run(&project)
            .diagnostics
            .iter()
            .any(|d| d.code == Code::UnknownStep)
    );
}

#[test]
fn rows_of_a_list_are_walked_too() {
    // The slash command lists its options as rows; none of its fields reads a step, and the
    // walk over them must not fail on a row that is not an object.
    let mut project = bot();
    let flow = project
        .flows
        .get_mut(&FlowName::parse("main").unwrap())
        .unwrap();
    flow.nodes[0].settings.insert(
        "options".to_owned(),
        json!([{ "name": "a", "description": "d", "type": "string" }, 5, null]),
    );
    let renamed = rename(&project, "main", "n2", "greeting").unwrap();
    assert_eq!(alias(&renamed.project, "main", "n2"), "greeting");
}
