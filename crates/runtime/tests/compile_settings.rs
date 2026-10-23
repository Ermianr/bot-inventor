//! Settings against the schema (`ARCHITECTURE.md` §3.3 step 3).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::Project;
use runtime::catalog::{
    FieldKind, FieldSpec, NodeRequires, NodeSpec, PortSpec, Registry, TriggerSpec,
};
use runtime::compile::{Code, compile_with};
use runtime::expr::CelEngine;
use serde_json::{Value, json};

/// A project whose reply node has these settings.
fn with_reply(settings: Value) -> Project {
    single(
        vec![
            slash("n1", "cmd", "ping"),
            node("n2", "reply", "discord.reply", settings),
        ],
        vec![line("n1", "next", "n2")],
    )
}

fn field_error(settings: Value, code: Code, path: &str) {
    let report = run(&with_reply(settings));
    let d = only(&report, code);
    assert_eq!(d.path.as_deref(), Some(path));
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n2");
    assert!(report.payload.is_none());
}

#[test]
fn a_missing_required_field() {
    field_error(json!({}), Code::MissingField, "content");
}

#[test]
fn an_unknown_field() {
    field_error(
        json!({ "content": "x", "colour": "red" }),
        Code::UnknownField,
        "colour",
    );
}

#[test]
fn a_wrong_type() {
    field_error(json!({ "content": 5 }), Code::WrongType, "content");
    field_error(json!({ "content": null }), Code::WrongType, "content");
}

#[test]
fn text_over_and_under_its_limits() {
    field_error(json!({ "content": "" }), Code::OutOfRange, "content");
    field_error(
        json!({ "content": "x".repeat(2001) }),
        Code::OutOfRange,
        "content",
    );
    let at_limit = run(&with_reply(json!({ "content": "x".repeat(2000) })));
    assert!(at_limit.diagnostics.is_empty());
}

fn command_with(settings: Value) -> Project {
    single(
        vec![node("n1", "cmd", "discord.slash_command", settings)],
        vec![],
    )
}

#[test]
fn a_value_outside_a_list_of_choices() {
    let project = command_with(json!({
        "name": "ping", "description": "d",
        "options": [{ "name": "who", "description": "d", "type": "colour" }]
    }));
    let report = run(&project);
    let d = only(&report, Code::NotInChoices);
    assert_eq!(d.path.as_deref(), Some("options[0].type"));
    assert!(d.message.contains("string"));
}

#[test]
fn fields_inside_a_list_are_checked_with_their_path() {
    let project = command_with(json!({
        "name": "ping", "description": "d",
        "options": [
            { "name": "a", "description": "d", "type": "string" },
            { "name": "b", "type": "string", "extra": true },
            "not an object"
        ]
    }));
    let report = run(&project);
    assert_eq!(
        only(&report, Code::MissingField).path.as_deref(),
        Some("options[1].description")
    );
    assert_eq!(
        only(&report, Code::UnknownField).path.as_deref(),
        Some("options[1].extra")
    );
    assert_eq!(
        only(&report, Code::WrongType).path.as_deref(),
        Some("options[2]")
    );
}

#[test]
fn a_list_over_its_limit() {
    let options: Vec<Value> = (0..65)
        .map(|i| json!({ "name": format!("o{i}"), "description": "d", "type": "string" }))
        .collect();
    let project = command_with(json!({ "name": "ping", "description": "d", "options": options }));
    let report = run(&project);
    assert_eq!(
        only(&report, Code::OutOfRange).path.as_deref(),
        Some("options")
    );
}

// A schema with the kinds that no shipped node uses yet.
static NUMBERS: NodeSpec = NodeSpec {
    type_id: "test.numbers",
    version: 1,
    fields: &[
        FieldSpec {
            name: "count",
            kind: FieldKind::Integer { min: 1, max: 10 },
            required: true,
        },
        FieldSpec {
            name: "file",
            kind: FieldKind::Asset,
            required: false,
        },
    ],
    ports: &[PortSpec { name: "next" }],
    outputs: &[],
    requires: NodeRequires::NOTHING,
    trigger: Some(TriggerSpec {
        event: "test",
        command: false,
        fields: &[],
        options_field: None,
    }),
};

fn numbers(settings: Value) -> runtime::compile::Report {
    let registry = Registry::new(&[&NUMBERS]).unwrap();
    let project = single(vec![node("n1", "t", "test.numbers", settings)], vec![]);
    compile_with(&registry, &CelEngine::new(), &project, "0.1.0")
}

#[test]
fn numbers_must_be_whole_and_in_range() {
    assert!(numbers(json!({ "count": 1 })).diagnostics.is_empty());
    assert!(numbers(json!({ "count": 10 })).diagnostics.is_empty());
    for bad in [json!(0), json!(11), json!(-1)] {
        let report = numbers(json!({ "count": bad }));
        assert_eq!(
            only(&report, Code::OutOfRange).path.as_deref(),
            Some("count")
        );
    }
    for bad in [json!(1.5), json!("3"), json!(true), json!(1e30)] {
        let report = numbers(json!({ "count": bad }));
        only(&report, Code::WrongType);
    }
}

#[test]
fn asset_paths_stay_inside_the_assets_folder() {
    let good = numbers(json!({ "count": 1, "file": "images/logo.png" }));
    assert!(good.diagnostics.is_empty());
    assert_eq!(
        good.payload.unwrap().requirements.assets,
        ["images/logo.png"]
    );
    for bad in [
        "",
        "/etc/passwd",
        "../secret",
        "a/../b",
        "a//b",
        "./a",
        "a\\b",
        "C:/x",
        "a/b/",
        "a\u{0}b",
    ] {
        let report = numbers(json!({ "count": 1, "file": bad }));
        let d = only(&report, Code::UnsafeAssetPath);
        assert_eq!(d.path.as_deref(), Some("file"), "{bad:?}");
    }
}

#[test]
fn a_duplicate_key_in_the_catalog_is_refused() {
    let error = Registry::new(&[&NUMBERS, &NUMBERS]).unwrap_err();
    assert_eq!(error.type_id, "test.numbers");
}

#[test]
fn the_built_in_catalog_has_distinct_keys() {
    let registry = Registry::builtin();
    let keys: Vec<_> = registry.specs().map(|s| (s.type_id, s.version)).collect();
    let mut sorted = keys.clone();
    sorted.dedup();
    assert_eq!(keys, sorted);
    assert_eq!(keys.len(), 4);
}
