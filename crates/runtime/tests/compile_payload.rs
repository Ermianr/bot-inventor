//! The report, the payload and the Ping sample (`ARCHITECTURE.md` §3.3 steps 6 and 7).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::path::Path;

use common::*;
use graph::{Payload, Project, VariableScope, VariableType};
use runtime::compile::Code;
use serde_json::json;

fn sample(file: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../graph")
        .join(file)
}

#[test]
fn the_ping_sample_compiles_to_the_committed_payload() {
    let loaded = Project::load(&sample("tests/samples/v1/ping")).unwrap();
    let report = run(&loaded.project);
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
    let payload = report.payload.unwrap();

    let committed = std::fs::read(sample("tests/payload_samples/v1/ping.payload")).unwrap();
    assert_eq!(payload.encode().unwrap(), committed);
    let json = std::fs::read_to_string(sample("tests/payload_samples/v1/ping.json")).unwrap();
    assert_eq!(payload.to_json().unwrap().trim_end(), json.trim_end());
}

#[test]
fn a_project_with_an_error_has_no_payload_and_a_warning_does_not_block() {
    let mut broken = ping();
    broken.flows.values_mut().next().unwrap().nodes[1].kind = "nope".to_owned();
    let report = run(&broken);
    assert!(report.has_errors());
    assert!(report.payload.is_none());

    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "yes", "y"),
            reply("n4", "after", "{{ steps.yes.message_id }}"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n2", "false", "n4"),
            line("n3", "next", "n4"),
        ],
    );
    let report = run(&project);
    assert!(!report.has_errors());
    assert_eq!(report.diagnostics.len(), 1);
    assert!(report.payload.is_some());
}

#[test]
fn the_same_project_gives_the_same_report_and_bytes() {
    let first = run(&ping());
    let second = run(&ping());
    assert_eq!(first.diagnostics, second.diagnostics);
    assert_eq!(
        first.payload.unwrap().encode().unwrap(),
        second.payload.unwrap().encode().unwrap()
    );
}

#[test]
fn diagnostics_come_in_a_fixed_order() {
    let project = project(vec![
        ("b", flow(vec![reply("n1", "a", "{{ ")], vec![])),
        (
            "a",
            flow(vec![reply("n2", "a", ""), reply("n1", "b", "")], vec![]),
        ),
    ]);
    let report = run(&project);
    let mut sorted = report.diagnostics.clone();
    sorted.sort();
    assert_eq!(report.diagnostics, sorted);
    assert_eq!(report.diagnostics[0].flow.as_ref().unwrap().as_str(), "a");
}

#[test]
fn the_payload_survives_encode_and_decode() {
    let payload = run(&ping()).payload.unwrap();
    let bytes = payload.encode().unwrap();
    assert_eq!(Payload::decode(&bytes).unwrap(), payload);
    payload.check().unwrap();
}

#[test]
fn requirements_are_sorted_and_without_duplicates() {
    let project = project(vec![
        ("one", flow(vec![slash("n1", "a", "one")], vec![])),
        ("two", flow(vec![slash("n1", "a", "two")], vec![])),
    ]);
    let payload = run(&project).payload.unwrap();
    assert_eq!(payload.requirements.intents, ["guilds"]);
    assert!(payload.requirements.cache.is_empty());
    assert!(payload.requirements.assets.is_empty());
}

#[test]
fn events_commands_and_variables_are_emitted() {
    let mut project = project(vec![
        ("zeta", flow(vec![slash("n1", "a", "zed")], vec![])),
        ("alpha", flow(vec![slash("n1", "a", "ay")], vec![])),
    ]);
    declare(
        &mut project,
        VariableScope::Bot,
        "count",
        VariableType::Integer,
        json!(0),
    );
    let payload = run(&project).payload.unwrap();
    let flows: Vec<_> = payload.flows.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(flows, ["alpha", "zeta"]);
    assert_eq!(payload.events.len(), 1);
    assert_eq!(payload.events[0].event, "slash_command");
    assert_eq!(payload.events[0].flows, [0, 1]);
    let commands: Vec<_> = payload
        .commands
        .iter()
        .map(|c| (c.name.as_str(), c.flow))
        .collect();
    assert_eq!(commands, [("ay", 0), ("zed", 1)]);
    assert_eq!(payload.variables.len(), 1);
}

#[test]
fn lines_become_sorted_indexes_by_port() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "a", "a"),
            reply("n4", "b", "b"),
            reply("n5", "c", "c"),
        ],
        vec![
            line("n2", "false", "n5"),
            line("n2", "true", "n4"),
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
        ],
    );
    let payload = run(&project).payload.unwrap();
    let branch = &payload.flows[0].nodes[1];
    let ports: Vec<_> = branch
        .next
        .iter()
        .map(|o| (o.port.as_str(), o.to.clone()))
        .collect();
    assert_eq!(ports, [("false", vec![4]), ("true", vec![2, 3])]);
}

fn hash_of(options: serde_json::Value) -> String {
    let project = single(
        vec![node(
            "n1",
            "cmd",
            "discord.slash_command",
            json!({ "name": "ban", "description": "d", "options": options }),
        )],
        vec![],
    );
    run(&project).payload.unwrap().commands[0].hash.clone()
}

#[test]
fn the_command_hash_changes_with_the_definition() {
    let one = json!([{ "name": "who", "description": "d", "type": "user", "required": true }]);
    let changed = json!([{ "name": "who", "description": "d", "type": "user", "required": false }]);
    let renamed = json!([{ "name": "whom", "description": "d", "type": "user", "required": true }]);
    assert_eq!(hash_of(one.clone()), hash_of(one.clone()));
    assert_ne!(hash_of(one.clone()), hash_of(changed));
    assert_ne!(hash_of(one), hash_of(renamed));
    assert_eq!(hash_of(json!([])).len(), 64);
}

#[test]
fn the_definition_is_what_discord_expects() {
    let project = single(
        vec![node(
            "n1",
            "cmd",
            "discord.slash_command",
            json!({
                "name": "ban", "description": "Ban someone", "ephemeral": true,
                "options": [{ "name": "who", "description": "Whom", "type": "user", "required": true }]
            }),
        )],
        vec![],
    );
    let definition = &run(&project).payload.unwrap().commands[0].definition;
    assert_eq!(
        serde_json::Value::Object(definition.clone()),
        json!({
            "type": 1, "name": "ban", "description": "Ban someone",
            "options": [{ "type": 6, "name": "who", "description": "Whom", "required": true }]
        })
    );
}

#[test]
fn no_diagnostic_is_a_code_without_a_message() {
    assert!(Code::ALL.iter().all(|c| !c.as_str().is_empty()));
}
