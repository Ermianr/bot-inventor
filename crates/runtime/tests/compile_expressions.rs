//! Expressions and templates (`ARCHITECTURE.md` §3.3 step 4).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::{Project, VariableScope, VariableType};
use runtime::compile::{Code, Severity};
use serde_json::json;

/// `/ping`, then a reply with this content.
fn reply_with(content: &str) -> Project {
    single(
        vec![slash("n1", "cmd", "ping"), reply("n2", "reply", content)],
        vec![line("n1", "next", "n2")],
    )
}

#[test]
fn a_syntax_error_is_reported_at_the_field() {
    let report = run(&reply_with("hello {{ 1 + }}"));
    let d = only(&report, Code::InvalidExpression);
    assert_eq!(d.path.as_deref(), Some("content"));
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n2");
}

#[test]
fn an_unclosed_segment_is_an_error() {
    only(&run(&reply_with("hello {{ 1")), Code::InvalidExpression);
}

#[test]
fn an_unknown_function_and_an_unknown_root_are_errors() {
    only(&run(&reply_with("{{ now() }}")), Code::InvalidExpression);
    only(
        &run(&reply_with("{{ nothing.here }}")),
        Code::InvalidExpression,
    );
}

#[test]
fn a_branch_condition_is_an_expression() {
    let project = single(
        vec![slash("n1", "cmd", "ping"), branch("n2", "check", "1 +")],
        vec![line("n1", "next", "n2")],
    );
    let report = run(&project);
    assert_eq!(
        only(&report, Code::InvalidExpression).path.as_deref(),
        Some("condition")
    );
}

#[test]
fn plain_text_is_not_stored_as_an_expression() {
    let payload = run(&reply_with("Pong!")).payload.unwrap();
    assert!(payload.flows[0].nodes[1].expressions.is_empty());
}

#[test]
fn a_template_with_segments_is_stored_with_its_path() {
    let payload = run(&reply_with("Hi {{ event.user.name }}!"))
        .payload
        .unwrap();
    let expressions = &payload.flows[0].nodes[1].expressions;
    assert_eq!(expressions.len(), 1);
    assert_eq!(expressions[0].path, "content");
    assert_eq!(expressions[0].source, "Hi {{ event.user.name }}!");
}

#[test]
fn a_condition_is_stored_even_without_a_name_in_it() {
    let project = single(
        vec![slash("n1", "cmd", "ping"), branch("n2", "check", "1 < 2")],
        vec![line("n1", "next", "n2")],
    );
    let payload = run(&project).payload.unwrap();
    assert_eq!(payload.flows[0].nodes[1].expressions[0].path, "condition");
}

#[test]
fn event_fields_are_checked_against_the_trigger() {
    assert!(
        run(&reply_with("{{ event.user.id }}"))
            .diagnostics
            .is_empty()
    );
    assert!(
        run(&reply_with("{{ event.member.roles }}"))
            .diagnostics
            .is_empty()
    );
    let report = run(&reply_with("{{ event.nothing }}"));
    let d = only(&report, Code::UnknownEventField);
    assert_eq!(d.path.as_deref(), Some("content"));
    only(
        &run(&reply_with("{{ event.user.id.more }}")),
        Code::UnknownEventField,
    );
    // A constant index is a name like any other.
    only(
        &run(&reply_with("{{ event.options['x'] }}")),
        Code::UnknownEventField,
    );
}

#[test]
fn options_of_the_command_are_event_fields() {
    let mut project = reply_with("{{ event.options.reason }} {{ event.options.missing }}");
    project.flows.values_mut().next().unwrap().nodes[0]
        .settings
        .insert(
            "options".to_owned(),
            json!([{ "name": "reason", "description": "d", "type": "string" }]),
        );
    let report = run(&project);
    let d = only(&report, Code::UnknownEventField);
    assert!(d.message.contains("event.options.missing"));
}

#[test]
fn a_dynamic_index_into_options_is_allowed() {
    let report = run(&reply_with("{{ event.options[event.user.id] }}"));
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
}

fn two_steps(second: &str) -> Project {
    single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "first", "one"),
            reply("n3", "second", second),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    )
}

#[test]
fn a_step_that_runs_before_is_valid() {
    let report = run(&two_steps("{{ steps.first.message_id }}"));
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
}

#[test]
fn an_unknown_alias_or_output_is_an_error() {
    only(
        &run(&two_steps("{{ steps.nobody.message_id }}")),
        Code::UnknownStep,
    );
    only(
        &run(&two_steps("{{ steps.first.nothing }}")),
        Code::UnknownOutput,
    );
}

#[test]
fn an_incomplete_reference_is_an_error() {
    only(
        &run(&two_steps("{{ steps.first }}")),
        Code::IncompleteReference,
    );
    only(
        &run(&two_steps("{{ steps['first'] }}")),
        Code::IncompleteReference,
    );
    only(
        &run(&two_steps("{{ vars.bot }}")),
        Code::IncompleteReference,
    );
}

#[test]
fn a_step_that_runs_after_or_is_the_node_itself_is_an_error() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "first", "{{ steps.second.message_id }}"),
            reply("n3", "second", "two"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    only(&run(&project), Code::StepNotBefore);
    only(
        &run(&two_steps("{{ steps.second.message_id }}")),
        Code::StepNotBefore,
    );
}

/// `/ping`, a branch, a reply on each side, and a last reply that reads `steps.<alias>`.
fn diamond(read: &str) -> Project {
    single(
        vec![
            slash("n1", "cmd", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "yes", "y"),
            reply("n4", "no", "n"),
            reply("n5", "after", &format!("{{{{ steps.{read}.message_id }}}}")),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n2", "false", "n4"),
            line("n3", "next", "n5"),
            line("n4", "next", "n5"),
        ],
    )
}

#[test]
fn a_step_on_only_some_paths_is_a_warning() {
    let report = run(&diamond("yes"));
    let d = only(&report, Code::StepSometimes);
    assert_eq!(d.severity(), Severity::Warning);
    assert!(!report.has_errors());
    assert!(report.payload.is_some(), "a warning does not block");
}

#[test]
fn a_step_before_the_split_is_always_valid() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "early", "e"),
            branch("n3", "check", "true"),
            reply("n4", "yes", "{{ steps.early.message_id }}"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "true", "n4"),
        ],
    );
    let report = run(&project);
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
}

#[test]
fn the_branch_itself_before_a_merge_is_valid() {
    // `check` dominates `after`, even though `after` has two paths.
    let report = run(&diamond("check"));
    only(&report, Code::UnknownOutput);
}

#[test]
fn the_step_on_a_sibling_path_never_runs_before() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "yes", "y"),
            reply("n4", "no", "{{ steps.yes.message_id }}"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n2", "false", "n4"),
        ],
    );
    only(&run(&project), Code::StepNotBefore);
}

#[test]
fn variables_must_be_declared() {
    let mut project = reply_with("{{ vars.bot.visits }}");
    only(&run(&project), Code::UnknownVariable);
    declare(
        &mut project,
        VariableScope::Bot,
        "visits",
        VariableType::Integer,
        json!(0),
    );
    assert!(run(&project).diagnostics.is_empty());
    // The scope is part of the name.
    let project2 = {
        let mut p = reply_with("{{ vars.user.visits }}");
        declare(
            &mut p,
            VariableScope::Bot,
            "visits",
            VariableType::Integer,
            json!(0),
        );
        p
    };
    only(&run(&project2), Code::UnknownVariable);
}

#[test]
fn the_variables_a_node_reads_are_listed() {
    let mut project = reply_with("{{ vars.bot.visits + vars.run.extra }} {{ vars.bot.visits }}");
    declare(
        &mut project,
        VariableScope::Bot,
        "visits",
        VariableType::Integer,
        json!(0),
    );
    declare(
        &mut project,
        VariableScope::Run,
        "extra",
        VariableType::Integer,
        json!(0),
    );
    let report = run(&project);
    assert_eq!(report.variable_reads.len(), 1);
    let reads = &report.variable_reads[0];
    assert_eq!(reads.node.as_str(), "n2");
    assert_eq!(reads.variables, ["bot.visits", "run.extra"]);
}

/// A trigger, a reply whose `error` port leads to a second reply that reads the error.
fn error_path(read: &str) -> Project {
    single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "first", "one"),
            reply("n3", "handler", read),
        ],
        vec![line("n1", "next", "n2"), line("n2", "error", "n3")],
    )
}

#[test]
fn error_is_available_after_an_error_port() {
    let report = run(&error_path("{{ error.kind }}: {{ error.message }}"));
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
}

#[test]
fn error_outside_an_error_path_is_an_error() {
    let report = run(&two_steps("{{ error.kind }}"));
    assert_eq!(
        only(&report, Code::ErrorOutsideErrorPath).path.as_deref(),
        Some("content")
    );
}

#[test]
fn error_on_some_paths_is_a_warning() {
    let project = single(
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
    );
    let report = run(&project);
    only(&report, Code::ErrorSometimes);
    assert!(!report.has_errors());
}

#[test]
fn an_unknown_error_field_is_an_error() {
    only(
        &run(&error_path("{{ error.code }}")),
        Code::UnknownErrorField,
    );
}

#[test]
fn references_are_not_ordered_in_a_flow_with_a_structure_error() {
    // The cycle is reported; the reference is not also reported as out of order.
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "a", "{{ steps.b.message_id }}"),
            reply("n3", "b", "x"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "next", "n2"),
        ],
    );
    let report = run(&project);
    only(&report, Code::Cycle);
    assert!(!has(&report, Code::StepNotBefore));
}

#[test]
fn messages_never_carry_a_value_of_the_source_data() {
    let report = run(&reply_with("{{ event.user.id.nothing('secret-value') }}"));
    assert!(
        report
            .diagnostics
            .iter()
            .all(|d| !d.message.contains("secret-value"))
    );
}
