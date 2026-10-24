//! The names the condition builder offers at a node are the names compile accepts there.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::{FlowName, NodeId, Project, VariableScope, VariableType};
use runtime::catalog::{Registry, ValueKind};
use runtime::compile::{
    Availability, Code, NameGroup, NameInfo, NameList, NamesError, Severity, expression_names,
};
use serde_json::json;

fn names(project: &Project, node: &str) -> NameList {
    expression_names(
        &Registry::builtin(),
        project,
        &FlowName::parse("main").unwrap(),
        &NodeId::parse(node).unwrap(),
    )
    .unwrap()
}

fn find<'a>(list: &'a NameList, source: &str) -> Option<&'a NameInfo> {
    list.names.iter().find(|name| name.source == source)
}

fn sources(list: &NameList) -> Vec<&str> {
    list.names.iter().map(|n| n.source.as_str()).collect()
}

/// `/ban` with options, a reply, a branch that is the node we ask about, and a reply after it.
/// A second reply hangs off the command and is not before the branch.
fn bot() -> Project {
    let cmd = node(
        "n1",
        "cmd",
        "discord.slash_command",
        json!({
            "name": "ban",
            "description": "d",
            "options": [
                { "name": "target", "description": "d", "type": "user", "required": true },
                { "name": "amount", "description": "d", "type": "integer", "required": true },
                { "name": "ratio", "description": "d", "type": "number" },
                { "name": "silent", "description": "d", "type": "boolean" },
                { "name": "reason", "description": "d", "type": "string" },
                { "name": "mi-opcion", "description": "d", "type": "string" },
            ],
        }),
    );
    let mut project = single(
        vec![
            cmd,
            reply("n2", "first", "x"),
            branch("n3", "probe", "true"),
            reply("n4", "later", "x"),
            reply("n5", "sibling", "x"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n1", "next", "n5"),
            line("n2", "next", "n3"),
            line("n3", "true", "n4"),
        ],
    );
    declare(
        &mut project,
        VariableScope::Server,
        "bans",
        VariableType::Integer,
        json!(0),
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "greeting",
        VariableType::Text,
        json!("hi"),
    );
    declare(
        &mut project,
        VariableScope::Run,
        "flag",
        VariableType::Boolean,
        json!(false),
    );
    declare(
        &mut project,
        VariableScope::User,
        "score",
        VariableType::Decimal,
        json!(0.5),
    );
    project
}

#[test]
fn the_lists_have_the_event_the_steps_before_and_the_variables() {
    let list = names(&bot(), "n3");
    assert!(list.order_known);
    let sources = sources(&list);
    assert_eq!(
        sources,
        [
            "event.command.name",
            "event.user.id",
            "event.user.name",
            "event.member.roles",
            "event.member.permissions",
            "event.guild.id",
            "event.channel.id",
            "event.timestamp",
            "event.options.target",
            "event.options.amount",
            "event.options.ratio",
            "event.options.silent",
            "event.options.reason",
            r#"event.options["mi-opcion"]"#,
            "steps.first.message_id",
            "vars.bot.greeting",
            "vars.run.flag",
            "vars.server.bans",
            "vars.user.score",
        ]
    );
}

#[test]
fn kinds_groups_and_optional_fields() {
    let list = names(&bot(), "n3");
    let kind = |source: &str| find(&list, source).unwrap().kind;
    assert_eq!(kind("event.user.id"), ValueKind::Text);
    assert_eq!(kind("event.member.roles"), ValueKind::List);
    assert_eq!(kind("event.options.target"), ValueKind::Text);
    assert_eq!(kind("event.options.amount"), ValueKind::Integer);
    assert_eq!(kind("event.options.ratio"), ValueKind::Decimal);
    assert_eq!(kind("event.options.silent"), ValueKind::Boolean);
    assert_eq!(kind("steps.first.message_id"), ValueKind::Text);
    assert_eq!(kind("vars.server.bans"), ValueKind::Integer);
    assert_eq!(kind("vars.user.score"), ValueKind::Decimal);
    assert_eq!(kind("vars.run.flag"), ValueKind::Boolean);

    let optional = |source: &str| find(&list, source).unwrap().optional;
    assert!(!optional("event.options.target"));
    assert!(!optional("event.user.id"));
    assert!(optional("event.options.reason"));
    assert!(optional("event.options.ratio"));

    let group = |source: &str| find(&list, source).unwrap().group;
    assert_eq!(group("event.user.id"), NameGroup::Event);
    assert_eq!(group("steps.first.message_id"), NameGroup::Step);
    assert_eq!(group("vars.bot.greeting"), NameGroup::Variable);
    assert!(
        list.names
            .iter()
            .all(|n| n.availability == Availability::Always)
    );
}

/// The branch `probe` reads `source`; the diagnostics of that field.
fn read_at_probe(project: &Project, source: &str) -> Vec<(Code, Severity)> {
    let mut project = project.clone();
    let flow = project.flows.values_mut().next().unwrap();
    let probe = flow
        .nodes
        .iter_mut()
        .find(|n| n.id.as_str() == "n3")
        .unwrap();
    probe.settings.insert(
        "condition".to_owned(),
        json!(format!("{source} == {source}")),
    );
    run(&project)
        .diagnostics
        .iter()
        .filter(|d| d.node.as_ref().is_some_and(|n| n.as_str() == "n3"))
        .map(|d| (d.code, d.severity()))
        .collect()
}

#[test]
fn every_name_offered_is_accepted_by_compile() {
    let project = bot();
    for name in &names(&project, "n3").names {
        assert_eq!(
            read_at_probe(&project, &name.source),
            [],
            "{} is offered but compile objects",
            name.source
        );
    }
}

#[test]
fn names_that_are_not_offered_are_reported_by_compile() {
    let project = bot();
    let list = names(&project, "n3");
    for (source, code) in [
        ("steps.later.message_id", Code::StepNotBefore),
        ("steps.sibling.message_id", Code::StepNotBefore),
        ("steps.probe.message_id", Code::UnknownOutput),
        ("steps.cmd.message_id", Code::UnknownOutput),
        ("steps.first.nope", Code::UnknownOutput),
        ("steps.nobody.x", Code::UnknownStep),
        ("event.options.nope", Code::UnknownEventField),
        ("event.nope", Code::UnknownEventField),
        ("vars.bot.undeclared", Code::UnknownVariable),
        ("vars.server.greeting", Code::UnknownVariable),
        ("error.kind", Code::ErrorOutsideErrorPath),
    ] {
        assert!(find(&list, source).is_none(), "{source} is offered");
        let found = read_at_probe(&project, source);
        assert!(
            found.iter().any(|(c, _)| *c == code),
            "{source}: expected {code:?}, got {found:?}"
        );
    }
}

#[test]
fn a_step_on_only_some_paths_is_offered_as_sometimes() {
    // cmd -> check; check.true -> first -> probe; check.false -> probe.
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "first", "x"),
            branch("n4", "probe", "true"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n2", "false", "n4"),
            line("n3", "next", "n4"),
        ],
    );
    let list = names(&project, "n4");
    let first = find(&list, "steps.first.message_id").unwrap();
    assert_eq!(first.availability, Availability::Sometimes);
    let report = run(&project);
    assert!(report.diagnostics.is_empty());
    let mut read = project.clone();
    read.flows.values_mut().next().unwrap().nodes[3]
        .settings
        .insert(
            "condition".to_owned(),
            json!("steps.first.message_id == ''"),
        );
    let found = run(&read);
    assert!(
        found
            .diagnostics
            .iter()
            .any(|d| d.code == Code::StepSometimes)
    );
    assert!(!found.has_errors());
}

#[test]
fn error_names_exist_only_after_an_error_port() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "first", "x"),
            reply("n3", "recover", "x"),
            branch("n4", "fine", "true"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "error", "n3"),
            line("n2", "next", "n4"),
        ],
    );
    let on_error = names(&project, "n3");
    for source in ["error.kind", "error.message"] {
        let name = find(&on_error, source).unwrap();
        assert_eq!(name.availability, Availability::Always);
        assert_eq!(name.group, NameGroup::Error);
        assert_eq!(name.kind, ValueKind::Text);
    }
    assert!(find(&names(&project, "n4"), "error.kind").is_none());
    assert!(find(&names(&project, "n2"), "error.kind").is_none());
}

#[test]
fn a_flow_that_is_not_sound_offers_no_steps_but_still_the_event_and_variables() {
    // The reply cannot be reached from the trigger.
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "orphan", "x"),
            branch("n3", "b", "true"),
        ],
        vec![line("n1", "next", "n3")],
    );
    let list = names(&project, "n3");
    assert!(!list.order_known);
    assert!(
        list.names
            .iter()
            .all(|n| matches!(n.group, NameGroup::Event | NameGroup::Variable))
    );
    assert!(find(&list, "event.user.id").is_some());

    // No trigger at all: nothing from the event.
    let none = single(vec![branch("n1", "b", "true")], vec![]);
    let list = names(&none, "n1");
    assert!(!list.order_known);
    assert!(list.names.is_empty());
}

#[test]
fn an_unknown_flow_or_node_is_an_error() {
    let project = bot();
    let registry = Registry::builtin();
    let flow = FlowName::parse("main").unwrap();
    assert_eq!(
        expression_names(
            &registry,
            &project,
            &FlowName::parse("other").unwrap(),
            &NodeId::parse("n3").unwrap()
        ),
        Err(NamesError::UnknownFlow)
    );
    assert_eq!(
        expression_names(&registry, &project, &flow, &NodeId::parse("zz").unwrap()),
        Err(NamesError::UnknownNode)
    );
}

#[test]
fn a_repeated_alias_makes_the_order_unknown() {
    // Two nodes with one alias are a structure error, so no step is offered.
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "same", "x"),
            reply("n3", "same", "x"),
            branch("n4", "b", "true"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "next", "n4"),
        ],
    );
    let list = names(&project, "n4");
    assert!(!list.order_known);
    assert!(list.names.iter().all(|n| n.group != NameGroup::Step));
}
