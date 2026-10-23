//! The message of every diagnostic code is fixed by a snapshot (`insta`).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::collections::BTreeMap;

use common::*;
use graph::{Project, VariableScope, VariableType};
use runtime::compile::{Code, MAX_FLOW_LINES, MAX_FLOW_NODES, Report};
use serde_json::{Value, json};

fn edit(project: &mut Project, change: impl FnOnce(&mut graph::Flow)) {
    change(project.flows.values_mut().next().unwrap());
}

fn command(settings: Value) -> Project {
    single(
        vec![node("n1", "cmd", "discord.slash_command", settings)],
        vec![],
    )
}

fn reading(content: &str) -> Project {
    single(
        vec![slash("n1", "cmd", "ping"), reply("n2", "reply", content)],
        vec![line("n1", "next", "n2")],
    )
}

fn option(name: &str) -> Value {
    json!({ "name": name, "description": "d", "type": "string" })
}

/// A project that produces each code, in the order of `Code::ALL`.
fn cases() -> Vec<(Code, Project)> {
    let mut cases = Vec::new();
    let mut add = |code: Code, project: Project| cases.push((code, project));

    let mut chain = vec![slash("n0", "cmd", "ping")];
    for i in 1..=MAX_FLOW_NODES {
        chain.push(reply(&format!("n{i}"), &format!("r{i}"), "x"));
    }
    add(Code::TooManyFlowNodes, single(chain, vec![]));

    let mut many_lines = ping();
    edit(&mut many_lines, |f| {
        f.lines = vec![line("n1", "next", "n2"); MAX_FLOW_LINES + 1];
    });
    add(Code::TooManyFlowLines, many_lines);

    let mut unknown = ping();
    edit(&mut unknown, |f| {
        f.nodes[1].kind = "discord.nope".to_owned()
    });
    add(Code::UnknownNodeType, unknown);

    let mut version = ping();
    edit(&mut version, |f| f.nodes[1].type_version = 7);
    add(Code::UnknownTypeVersion, version);

    add(
        Code::DuplicateNodeId,
        single(
            vec![slash("n1", "a", "ping"), reply("n1", "b", "x")],
            vec![],
        ),
    );
    add(
        Code::DuplicateAlias,
        single(
            vec![slash("n1", "same", "ping"), reply("n2", "same", "x")],
            vec![line("n1", "next", "n2")],
        ),
    );

    let mut from = ping();
    edit(&mut from, |f| f.lines.push(line("zz", "next", "n2")));
    add(Code::LineFromUnknownNode, from);
    let mut to = ping();
    edit(&mut to, |f| f.lines.push(line("n2", "next", "zz")));
    add(Code::LineToUnknownNode, to);
    let mut port = ping();
    edit(&mut port, |f| f.lines[0] = line("n1", "true", "n2"));
    add(Code::UnknownPort, port);
    let mut into = ping();
    edit(&mut into, |f| f.lines.push(line("n2", "next", "n1")));
    add(Code::LineIntoTrigger, into);
    let mut twice = ping();
    edit(&mut twice, |f| f.lines.push(line("n1", "next", "n2")));
    add(Code::DuplicateLine, twice);
    add(Code::NoTrigger, single(vec![reply("n1", "a", "x")], vec![]));
    add(
        Code::MultipleTriggers,
        single(
            vec![slash("n1", "a", "one"), slash("n2", "b", "two")],
            vec![],
        ),
    );
    add(
        Code::UnreachableNode,
        single(
            vec![slash("n1", "a", "ping"), reply("n2", "b", "x")],
            vec![],
        ),
    );
    let mut cycle = ping();
    edit(&mut cycle, |f| f.lines.push(line("n2", "next", "n2")));
    add(Code::Cycle, cycle);

    add(
        Code::MissingField,
        single(
            vec![
                slash("n1", "a", "ping"),
                node("n2", "b", "discord.reply", json!({})),
            ],
            vec![line("n1", "next", "n2")],
        ),
    );
    add(
        Code::UnknownField,
        single(
            vec![
                slash("n1", "a", "ping"),
                node(
                    "n2",
                    "b",
                    "discord.reply",
                    json!({ "content": "x", "colour": 1 }),
                ),
            ],
            vec![line("n1", "next", "n2")],
        ),
    );
    add(
        Code::WrongType,
        single(
            vec![
                slash("n1", "a", "ping"),
                node("n2", "b", "discord.reply", json!({ "content": 5 })),
            ],
            vec![line("n1", "next", "n2")],
        ),
    );
    add(
        Code::OutOfRange,
        single(
            vec![
                slash("n1", "a", "ping"),
                node("n2", "b", "discord.reply", json!({ "content": "" })),
            ],
            vec![line("n1", "next", "n2")],
        ),
    );
    add(
        Code::NotInChoices,
        command(json!({
            "name": "a", "description": "d",
            "options": [{ "name": "x", "description": "d", "type": "colour" }]
        })),
    );
    // The built-in nodes have no asset field; the unsafe path is covered in `compile_settings`
    // and its message is checked below through the schema that has one.
    add(Code::InvalidExpression, reading("{{ now() }}"));
    add(Code::IncompleteReference, reading("{{ steps.cmd }}"));
    add(Code::UnknownEventField, reading("{{ event.nothing }}"));
    add(Code::UnknownStep, reading("{{ steps.nobody.id }}"));
    add(Code::UnknownOutput, reading("{{ steps.cmd.nothing }}"));
    add(Code::StepNotBefore, reading("{{ steps.reply.message_id }}"));
    add(
        Code::StepSometimes,
        single(
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
        ),
    );
    add(Code::UnknownVariable, reading("{{ vars.bot.visits }}"));
    add(Code::UnknownErrorField, reading("{{ error.code }}"));
    add(Code::ErrorOutsideErrorPath, reading("{{ error.kind }}"));
    add(
        Code::ErrorSometimes,
        single(
            vec![
                slash("n1", "cmd", "ping"),
                reply("n2", "first", "one"),
                reply("n3", "second", "two"),
                reply("n4", "merge", "{{ error.kind }}"),
            ],
            vec![
                line("n1", "next", "n2"),
                line("n2", "next", "n3"),
                line("n2", "error", "n4"),
                line("n3", "next", "n4"),
            ],
        ),
    );

    let mut twice_declared = ping();
    for _ in 0..2 {
        declare(
            &mut twice_declared,
            VariableScope::Bot,
            "x",
            VariableType::Integer,
            json!(0),
        );
    }
    add(Code::DuplicateVariable, twice_declared);
    let mut mismatch = ping();
    declare(
        &mut mismatch,
        VariableScope::Bot,
        "x",
        VariableType::Integer,
        json!("zero"),
    );
    add(Code::InitialTypeMismatch, mismatch);

    add(
        Code::InvalidCommandName,
        command(json!({ "name": "Ping", "description": "d" })),
    );
    add(
        Code::InvalidDescription,
        command(json!({ "name": "ping", "description": "d".repeat(101) })),
    );
    let options: Vec<Value> = (0..26).map(|i| option(&format!("o{i}"))).collect();
    add(
        Code::TooManyOptions,
        command(json!({ "name": "a", "description": "d", "options": options })),
    );
    add(
        Code::DuplicateOption,
        command(json!({ "name": "a", "description": "d", "options": [option("x"), option("x")] })),
    );
    add(
        Code::OptionOrder,
        command(json!({
            "name": "a", "description": "d",
            "options": [option("x"), { "name": "y", "description": "d", "type": "user", "required": true }]
        })),
    );
    let long = json!({ "name": "n".repeat(64), "description": "d".repeat(200), "type": "string" });
    add(
        Code::CommandTooLarge,
        command(json!({ "name": "a", "description": "d", "options": vec![long; 40] })),
    );
    add(
        Code::DuplicateCommand,
        project(vec![
            ("a", flow(vec![slash("n1", "cmd", "ping")], vec![])),
            ("b", flow(vec![slash("n1", "cmd", "ping")], vec![])),
        ]),
    );
    let many: Vec<(String, graph::Flow)> = (0..101)
        .map(|i| {
            (
                format!("f{i}"),
                flow(vec![slash("n1", "cmd", &format!("c{i}"))], vec![]),
            )
        })
        .collect();
    add(
        Code::TooManyCommands,
        project(many.iter().map(|(n, f)| (n.as_str(), f.clone())).collect()),
    );
    cases
}

fn message(report: &Report, code: Code) -> String {
    let found: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| d.code == code)
        .collect();
    assert!(
        !found.is_empty(),
        "{code:?} not produced: {:#?}",
        report.diagnostics
    );
    found[0].to_string()
}

#[test]
fn every_code_has_a_snapshot() {
    let cases = cases();
    let produced: BTreeMap<Code, String> = cases
        .iter()
        .map(|(code, project)| (*code, message(&run(project), *code)))
        .collect();
    // `UnsafeAssetPath` has no case here and `InvalidPayload` cannot be produced by a project:
    // the first is snapshotted from a schema with an asset field, the second is a guard.
    for code in Code::ALL {
        if matches!(code, Code::UnsafeAssetPath | Code::InvalidPayload) {
            continue;
        }
        assert!(produced.contains_key(code), "{code:?} has no case");
    }
    for (code, text) in produced {
        insta::assert_snapshot!(code.as_str(), text);
    }
}

#[test]
fn the_unsafe_asset_path_message() {
    use runtime::catalog::{
        FieldKind, FieldSpec, NodeRequires, NodeSpec, PortSpec, Registry, TriggerSpec,
    };
    static SPEC: NodeSpec = NodeSpec {
        type_id: "test.file",
        version: 1,
        fields: &[FieldSpec {
            name: "file",
            kind: FieldKind::Asset,
            required: true,
        }],
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
    let registry = Registry::new(&[&SPEC]).unwrap();
    let project = single(
        vec![node("n1", "a", "test.file", json!({ "file": "../x" }))],
        vec![],
    );
    let report = runtime::compile::compile_with(
        &registry,
        &runtime::expr::CelEngine::new(),
        &project,
        "0.1.0",
    );
    insta::assert_snapshot!(
        Code::UnsafeAssetPath.as_str(),
        message(&report, Code::UnsafeAssetPath)
    );
}

#[test]
fn a_message_never_carries_the_value_of_a_setting() {
    let secret = "SECRET-TOKEN-VALUE";
    let projects = [
        single(
            vec![
                slash("n1", "a", "ping"),
                node(
                    "n2",
                    "b",
                    "discord.reply",
                    json!({ "content": secret, "extra": 1 }),
                ),
            ],
            vec![line("n1", "next", "n2")],
        ),
        command(json!({ "name": secret, "description": secret })),
        command(json!({
            "name": "a", "description": "d",
            "options": [{ "name": "x", "description": "d", "type": secret }]
        })),
        single(
            vec![node(
                "n1",
                "a",
                "discord.slash_command",
                json!({ "name": 1, "description": secret }),
            )],
            vec![],
        ),
    ];
    for project in projects {
        let report = run(&project);
        for d in &report.diagnostics {
            assert!(!d.to_string().contains(secret), "{d}");
        }
    }
}
