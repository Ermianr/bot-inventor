//! The graph rules of `ARCHITECTURE.md` §3.3 step 2, one test each.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use runtime::compile::{Code, MAX_FLOW_LINES, MAX_FLOW_NODES};

#[test]
fn ping_has_no_diagnostic() {
    let report = run(&ping());
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
    assert!(report.payload.is_some());
}

#[test]
fn an_unknown_node_type_is_an_error() {
    let mut project = ping();
    project.flows.values_mut().next().unwrap().nodes[1].kind = "discord.nope".to_owned();
    let report = run(&project);
    let d = only(&report, Code::UnknownNodeType);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n2");
    assert!(report.payload.is_none());
}

#[test]
fn an_unknown_type_version_is_an_error() {
    let mut project = ping();
    project.flows.values_mut().next().unwrap().nodes[1].type_version = 9;
    let report = run(&project);
    only(&report, Code::UnknownTypeVersion);
}

#[test]
fn a_duplicate_node_id_is_an_error() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "a", "x"),
            reply("n2", "b", "y"),
        ],
        vec![line("n1", "next", "n2")],
    );
    let report = run(&project);
    let d = only(&report, Code::DuplicateNodeId);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n2");
}

#[test]
fn a_duplicate_alias_is_an_error() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "same", "x"),
            reply("n3", "same", "y"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    let report = run(&project);
    let d = only(&report, Code::DuplicateAlias);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n3");
    assert_eq!(d.path.as_deref(), Some("alias"));
}

#[test]
fn an_alias_may_repeat_in_another_flow() {
    let flows = vec![
        ("a", flow(vec![slash("n1", "cmd", "one")], vec![])),
        ("b", flow(vec![slash("n1", "cmd", "two")], vec![])),
    ];
    let report = run(&project(flows));
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
}

#[test]
fn a_line_from_an_unknown_node_is_an_error() {
    let mut project = ping();
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("zz", "next", "n2"));
    let report = run(&project);
    let d = only(&report, Code::LineFromUnknownNode);
    assert_eq!(d.path.as_deref(), Some("lines[1]"));
}

#[test]
fn a_line_to_an_unknown_node_is_an_error() {
    let mut project = ping();
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("n2", "next", "zz"));
    let report = run(&project);
    let d = only(&report, Code::LineToUnknownNode);
    assert_eq!(d.path.as_deref(), Some("lines[1]"));
}

#[test]
fn a_line_from_a_port_the_type_does_not_declare_is_an_error() {
    let mut project = ping();
    project.flows.values_mut().next().unwrap().lines[0] = line("n1", "true", "n2");
    let report = run(&project);
    let d = only(&report, Code::UnknownPort);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n1");
    assert_eq!(d.path.as_deref(), Some("lines[0]"));
}

#[test]
fn a_line_into_the_trigger_is_an_error() {
    let mut project = ping();
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("n2", "next", "n1"));
    let report = run(&project);
    only(&report, Code::LineIntoTrigger);
    only(&report, Code::Cycle);
}

#[test]
fn a_duplicate_line_is_an_error() {
    let mut project = ping();
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("n1", "next", "n2"));
    let report = run(&project);
    let d = only(&report, Code::DuplicateLine);
    assert_eq!(d.path.as_deref(), Some("lines[1]"));
}

#[test]
fn a_flow_with_no_trigger_is_an_error() {
    let project = single(vec![reply("n1", "a", "x")], vec![]);
    let report = run(&project);
    let d = only(&report, Code::NoTrigger);
    assert!(d.node.is_none());
}

#[test]
fn a_flow_with_two_triggers_is_an_error() {
    let project = single(
        vec![slash("n1", "a", "one"), slash("n2", "b", "two")],
        vec![],
    );
    let report = run(&project);
    assert_eq!(
        codes(&report)
            .iter()
            .filter(|c| **c == Code::MultipleTriggers)
            .count(),
        2
    );
}

#[test]
fn a_node_that_is_not_reachable_is_an_error() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "a", "x"),
            reply("n3", "b", "y"),
        ],
        vec![line("n1", "next", "n2")],
    );
    let report = run(&project);
    let d = only(&report, Code::UnreachableNode);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n3");
}

#[test]
fn a_self_loop_is_a_cycle() {
    let mut project = ping();
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("n2", "next", "n2"));
    let report = run(&project);
    let d = only(&report, Code::Cycle);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n2");
}

#[test]
fn two_nodes_in_a_cycle_are_reported() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            reply("n2", "a", "x"),
            reply("n3", "b", "y"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "error", "n2"),
        ],
    );
    let report = run(&project);
    let d = only(&report, Code::Cycle);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n2");
}

/// A trigger followed by `count - 1` replies in a row.
fn chain(count: usize) -> graph::Project {
    let mut nodes = vec![slash("n0", "cmd", "ping")];
    let mut lines = Vec::new();
    for i in 1..count {
        nodes.push(reply(&format!("n{i}"), &format!("r{i}"), "x"));
        lines.push(line(&format!("n{}", i - 1), "next", &format!("n{i}")));
    }
    single(nodes, lines)
}

#[test]
fn a_long_cycle_is_reported() {
    let mut project = chain(200);
    project
        .flows
        .values_mut()
        .next()
        .unwrap()
        .lines
        .push(line("n199", "next", "n100"));
    let report = run(&project);
    let d = only(&report, Code::Cycle);
    assert_eq!(d.node.as_ref().unwrap().as_str(), "n100");
}

#[test]
fn the_largest_flow_compiles_on_a_small_stack() {
    let handle = std::thread::Builder::new()
        .stack_size(512 * 1024)
        .spawn(|| {
            let project = chain(MAX_FLOW_NODES);
            let report = run(&project);
            assert!(
                report.diagnostics.is_empty(),
                "{:?}",
                report.diagnostics.first()
            );
            let payload = report.payload.unwrap();
            assert_eq!(payload.flows[0].nodes.len(), MAX_FLOW_NODES);
            // Dropping the project and the payload does not recurse either.
            drop(project);
            drop(payload);
        })
        .unwrap();
    handle.join().unwrap();
}

#[test]
fn a_flow_over_the_node_limit_is_refused() {
    let report = run(&chain(MAX_FLOW_NODES + 1));
    let d = only(&report, Code::TooManyFlowNodes);
    assert!(d.node.is_none());
    assert!(report.payload.is_none());
}

#[test]
fn a_flow_over_the_line_limit_is_refused() {
    let mut project = chain(3);
    let lines = &mut project.flows.values_mut().next().unwrap().lines;
    while lines.len() <= MAX_FLOW_LINES {
        lines.push(line("n1", "next", "n2"));
    }
    let report = run(&project);
    only(&report, Code::TooManyFlowLines);
}

#[test]
fn nodes_that_branch_and_merge_compile() {
    let project = single(
        vec![
            slash("n1", "cmd", "ping"),
            branch("n2", "check", "true"),
            reply("n3", "yes", "y"),
            reply("n4", "no", "n"),
            reply("n5", "after", "done"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "true", "n3"),
            line("n2", "false", "n4"),
            line("n3", "next", "n5"),
            line("n4", "next", "n5"),
        ],
    );
    let report = run(&project);
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
    let payload = report.payload.unwrap();
    assert_eq!(payload.flows[0].nodes[0].id.as_str(), "n1");
    assert_eq!(payload.flows[0].nodes[4].id.as_str(), "n5");
}
