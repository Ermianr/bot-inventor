//! Variable declarations and the limits Discord puts on commands (`ARCHITECTURE.md` §7).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::{VariableScope, VariableType};
use runtime::compile::{Code, MAX_COMMANDS, MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS, MAX_OPTIONS};
use serde_json::{Value, json};

fn command(settings: Value) -> graph::Project {
    single(
        vec![node("n1", "cmd", "discord.slash_command", settings)],
        vec![],
    )
}

fn option(name: &str) -> Value {
    json!({ "name": name, "description": "d", "type": "string" })
}

#[test]
fn a_variable_is_declared_once_per_scope() {
    let mut project = ping();
    declare(
        &mut project,
        VariableScope::Bot,
        "visits",
        VariableType::Integer,
        json!(0),
    );
    declare(
        &mut project,
        VariableScope::User,
        "visits",
        VariableType::Integer,
        json!(0),
    );
    assert!(run(&project).diagnostics.is_empty());
    declare(
        &mut project,
        VariableScope::Bot,
        "visits",
        VariableType::Text,
        json!(""),
    );
    let report = run(&project);
    let d = only(&report, Code::DuplicateVariable);
    assert_eq!(d.path.as_deref(), Some("variables[2]"));
    assert!(d.flow.is_none() && d.node.is_none());
}

#[test]
fn the_initial_value_matches_the_type() {
    let cases = [
        (VariableType::Integer, json!(3), true),
        (VariableType::Integer, json!(-3), true),
        (VariableType::Integer, json!(1.5), false),
        (VariableType::Integer, json!("3"), false),
        (VariableType::Decimal, json!(3), true),
        (VariableType::Decimal, json!(1.5), true),
        (VariableType::Decimal, json!(null), false),
        (VariableType::Text, json!(""), true),
        (VariableType::Text, json!(1), false),
        (VariableType::Boolean, json!(false), true),
        (VariableType::Boolean, json!(0), false),
    ];
    for (kind, initial, valid) in cases {
        let mut project = ping();
        declare(&mut project, VariableScope::Bot, "x", kind, initial.clone());
        let report = run(&project);
        assert_eq!(
            !has(&report, Code::InitialTypeMismatch),
            valid,
            "{kind:?} {initial}"
        );
    }
}

#[test]
fn command_names_have_1_to_32_lowercase_characters() {
    let at_limit = "a".repeat(MAX_NAME_CHARS);
    let report = run(&command(json!({ "name": at_limit, "description": "d" })));
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
    for bad in [
        "a".repeat(MAX_NAME_CHARS + 1),
        "Ping".to_owned(),
        "two words".to_owned(),
    ] {
        let report = run(&command(json!({ "name": bad, "description": "d" })));
        assert_eq!(
            only(&report, Code::InvalidCommandName).path.as_deref(),
            Some("name")
        );
    }
}

#[test]
fn command_descriptions_have_1_to_100_characters() {
    let at_limit = "d".repeat(MAX_DESCRIPTION_CHARS);
    assert!(
        run(&command(json!({ "name": "a", "description": at_limit })))
            .diagnostics
            .is_empty()
    );
    let over = "d".repeat(MAX_DESCRIPTION_CHARS + 1);
    let report = run(&command(json!({ "name": "a", "description": over })));
    assert_eq!(
        only(&report, Code::InvalidDescription).path.as_deref(),
        Some("description")
    );
}

#[test]
fn a_command_has_at_most_25_options() {
    let options: Vec<Value> = (0..MAX_OPTIONS).map(|i| option(&format!("o{i}"))).collect();
    let report = run(&command(
        json!({ "name": "a", "description": "d", "options": options }),
    ));
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);

    let options: Vec<Value> = (0..=MAX_OPTIONS)
        .map(|i| option(&format!("o{i}")))
        .collect();
    let report = run(&command(
        json!({ "name": "a", "description": "d", "options": options }),
    ));
    assert_eq!(
        only(&report, Code::TooManyOptions).path.as_deref(),
        Some("options")
    );
}

#[test]
fn option_names_and_descriptions_follow_the_same_rules() {
    let report = run(&command(json!({
        "name": "a", "description": "d",
        "options": [
            { "name": "Bad", "description": "d", "type": "string" },
            { "name": "ok", "description": "d".repeat(101), "type": "string" }
        ]
    })));
    assert_eq!(
        only(&report, Code::InvalidCommandName).path.as_deref(),
        Some("options[0].name")
    );
    assert_eq!(
        only(&report, Code::InvalidDescription).path.as_deref(),
        Some("options[1].description")
    );
}

#[test]
fn option_names_are_unique() {
    let report = run(&command(
        json!({ "name": "a", "description": "d", "options": [option("x"), option("y"), option("x")] }),
    ));
    assert_eq!(
        only(&report, Code::DuplicateOption).path.as_deref(),
        Some("options[2].name")
    );
}

#[test]
fn required_options_come_first() {
    let required = json!({ "name": "r", "description": "d", "type": "user", "required": true });
    let report = run(&command(
        json!({ "name": "a", "description": "d", "options": [option("x"), required.clone()] }),
    ));
    assert_eq!(
        only(&report, Code::OptionOrder).path.as_deref(),
        Some("options[1].required")
    );
    let report = run(&command(
        json!({ "name": "a", "description": "d", "options": [required, option("x")] }),
    ));
    assert!(report.diagnostics.is_empty());
}

#[test]
fn a_command_over_8000_characters_is_refused() {
    // 40 options of 64 + 200 characters is over the limit; the schema accepts these lengths so
    // that Discord's own limits are reported by their own codes.
    let long = json!({ "name": "n".repeat(64), "description": "d".repeat(200), "type": "string" });
    let options = vec![long; 40];
    let report = run(&command(
        json!({ "name": "a", "description": "d", "options": options }),
    ));
    assert_eq!(
        only(&report, Code::CommandTooLarge).path.as_deref(),
        Some("options")
    );
}

fn commands(names: &[&str]) -> graph::Project {
    project(
        names
            .iter()
            .enumerate()
            .map(|(i, name)| {
                (
                    format!("flow{i}"),
                    flow(vec![slash("n1", "cmd", name)], vec![]),
                )
            })
            .collect::<Vec<_>>()
            .iter()
            .map(|(n, f)| (n.as_str(), f.clone()))
            .collect(),
    )
}

#[test]
fn a_command_name_is_unique_across_flows() {
    let report = run(&commands(&["ping", "pong", "ping"]));
    let d = only(&report, Code::DuplicateCommand);
    assert_eq!(d.flow.as_ref().unwrap().as_str(), "flow2");
    assert_eq!(d.path.as_deref(), Some("name"));
}

#[test]
fn a_project_has_at_most_100_commands() {
    let names: Vec<String> = (0..MAX_COMMANDS).map(|i| format!("c{i}")).collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    assert!(run(&commands(&refs)).diagnostics.is_empty());

    let names: Vec<String> = (0..=MAX_COMMANDS).map(|i| format!("c{i}")).collect();
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let report = run(&commands(&refs));
    let d = only(&report, Code::TooManyCommands);
    assert!(d.flow.is_none());
}
