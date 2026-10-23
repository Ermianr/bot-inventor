//! Compile and `data.set_variable`: the variable must be declared and `add` needs a number.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::{Project, VariableScope, VariableType};
use runtime::compile::Code;
use serde_json::json;

/// `/ping` then a `set_variable` with the settings given, over a project that declares one
/// variable of each type.
fn with_node(variable: &str, operation: Option<&str>, value: &str) -> Project {
    let mut set = set_variable("n2", "put", variable, operation.unwrap_or("set"), value);
    if operation.is_none() {
        set.settings.remove("operation");
    }
    let mut project = single(
        vec![slash("n1", "s", "ping"), set],
        vec![line("n1", "next", "n2")],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "n",
        VariableType::Integer,
        json!(0),
    );
    declare(
        &mut project,
        VariableScope::Server,
        "ratio",
        VariableType::Decimal,
        json!(0.5),
    );
    declare(
        &mut project,
        VariableScope::Member,
        "motto",
        VariableType::Text,
        json!(""),
    );
    declare(
        &mut project,
        VariableScope::User,
        "vip",
        VariableType::Boolean,
        json!(false),
    );
    declare(
        &mut project,
        VariableScope::Run,
        "tmp",
        VariableType::Integer,
        json!(0),
    );
    project
}

#[test]
fn a_variable_of_any_scope_can_be_set_and_a_number_can_be_added_to() {
    for (variable, operation, value) in [
        ("bot.n", Some("set"), "1"),
        ("bot.n", None, "1"),
        ("bot.n", Some("add"), "-1"),
        ("server.ratio", Some("add"), "0.5"),
        ("member.motto", Some("set"), "'hi'"),
        ("user.vip", Some("set"), "true"),
        ("run.tmp", Some("add"), "event.user.id.size()"),
    ] {
        let report = run(&with_node(variable, operation, value));
        assert!(
            !report.has_errors(),
            "{variable}: {:#?}",
            report.diagnostics
        );
        assert!(report.payload.is_some());
    }
}

#[test]
fn the_payload_keeps_the_settings_and_the_value_expression() {
    let payload = payload(&with_node("bot.n", Some("add"), "vars.bot.n + 1"));
    let node = &payload.flows[0].nodes[1];
    assert_eq!(node.kind, "data.set_variable");
    assert_eq!(node.settings["variable"], "bot.n");
    assert_eq!(node.settings["operation"], "add");
    assert_eq!(node.expressions.len(), 1);
    assert_eq!(node.expressions[0].path, "value");
    assert_eq!(payload.variables.len(), 5);
}

#[test]
fn a_variable_that_is_not_declared_is_an_error_on_the_setting() {
    for variable in ["bot.other", "nodot", "member.n", "bot.", "run.n"] {
        let report = run(&with_node(variable, Some("set"), "1"));
        let diagnostic = only(&report, Code::UnknownVariable);
        assert_eq!(diagnostic.path.as_deref(), Some("variable"), "{variable}");
        assert_eq!(diagnostic.node.as_ref().unwrap().as_str(), "n2");
        assert!(diagnostic.message.contains("is not a declared variable"));
        assert!(report.payload.is_none());
    }
}

#[test]
fn add_needs_a_variable_that_holds_a_number() {
    for variable in ["member.motto", "user.vip"] {
        let report = run(&with_node(variable, Some("add"), "1"));
        let diagnostic = only(&report, Code::AddToNonNumber);
        assert_eq!(diagnostic.path.as_deref(), Some("operation"));
        assert!(
            diagnostic.message.contains(variable),
            "{}",
            diagnostic.message
        );
    }
    // `set` on the same variables is fine.
    assert!(!run(&with_node("member.motto", Some("set"), "'x'")).has_errors());
}

#[test]
fn a_long_variable_name_is_cut_short_in_the_message() {
    let name = format!("bot.{}", "a".repeat(60));
    let report = run(&with_node(&name, Some("set"), "1"));
    let diagnostic = only(&report, Code::UnknownVariable);
    assert!(diagnostic.message.contains('…'));
    assert!(diagnostic.message.chars().count() < 100);
}

#[test]
fn the_settings_follow_the_schema() {
    let mut project = with_node("bot.n", Some("set"), "1");
    let flow = project.flows.values_mut().next().unwrap();
    flow.nodes[1].settings.remove("variable");
    flow.nodes[1].settings.remove("value");
    let report = run(&project);
    let missing: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| d.code == Code::MissingField)
        .map(|d| d.path.clone().unwrap())
        .collect();
    assert_eq!(missing, ["value", "variable"]);

    let report = run(&with_node("bot.n", Some("multiply"), "1"));
    let diagnostic = only(&report, Code::NotInChoices);
    assert_eq!(diagnostic.path.as_deref(), Some("operation"));

    let mut project = with_node("bot.n", Some("set"), "1");
    let flow = project.flows.values_mut().next().unwrap();
    flow.nodes[1].settings.insert("variable".into(), json!(7));
    flow.nodes[1].settings.insert("extra".into(), json!(1));
    let report = run(&project);
    assert!(has(&report, Code::WrongType));
    assert!(has(&report, Code::UnknownField));
    // A node with settings that do not match is not asked about its variable.
    assert!(!has(&report, Code::UnknownVariable));

    for variable in ["", "ab", &"a".repeat(72)] {
        let report = run(&with_node(variable, Some("set"), "1"));
        assert!(has(&report, Code::OutOfRange), "{variable:?}");
    }
}

#[test]
fn the_value_is_an_expression_checked_like_any_other() {
    let report = run(&with_node("bot.n", Some("set"), "event.nothing"));
    assert_eq!(
        only(&report, Code::UnknownEventField).path.as_deref(),
        Some("value")
    );
    let report = run(&with_node("bot.n", Some("set"), "1 +"));
    assert_eq!(
        only(&report, Code::InvalidExpression).path.as_deref(),
        Some("value")
    );
    let report = run(&with_node("bot.n", Some("set"), "vars.bot.nothing"));
    assert_eq!(
        only(&report, Code::UnknownVariable).path.as_deref(),
        Some("value")
    );
}

#[test]
fn the_variables_the_value_reads_are_listed_for_the_batch() {
    let report = run(&with_node(
        "bot.n",
        Some("set"),
        "vars.bot.n + vars.server.ratio.size() + vars.run.tmp",
    ));
    assert_eq!(report.variable_reads.len(), 1);
    assert_eq!(report.variable_reads[0].node.as_str(), "n2");
    assert_eq!(
        report.variable_reads[0].variables,
        ["bot.n", "run.tmp", "server.ratio"]
    );
    // Writing a variable is not reading it.
    let report = run(&with_node("bot.n", Some("set"), "1"));
    assert!(report.variable_reads.is_empty());
}

#[test]
fn later_nodes_read_the_new_value_as_an_output() {
    let mut project = single(
        vec![
            slash("n1", "s", "ping"),
            set_variable("n2", "put", "bot.n", "add", "1"),
            reply("n3", "say", "{{ steps.put.value }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "n",
        VariableType::Integer,
        json!(0),
    );
    assert!(!run(&project).has_errors());

    let flow = project.flows.values_mut().next().unwrap();
    flow.nodes[2] = reply("n3", "say", "{{ steps.put.other }}");
    let report = run(&project);
    assert!(has(&report, Code::UnknownOutput));
}

#[test]
fn the_node_has_an_error_port_and_a_next_port() {
    let mut project = with_node("bot.n", Some("set"), "1");
    let flow = project.flows.values_mut().next().unwrap();
    flow.nodes
        .push(reply("n3", "failed", "{{ error.message }}"));
    flow.nodes.push(reply("n4", "done", "ok"));
    flow.lines.push(line("n2", "error", "n3"));
    flow.lines.push(line("n2", "next", "n4"));
    assert!(!run(&project).has_errors());
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("n2", "other", "n4"));
    assert!(has(&run(&project), Code::UnknownPort));
}
