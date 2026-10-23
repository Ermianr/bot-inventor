//! Builders for the compile tests: small projects made in memory.
#![allow(dead_code, clippy::unwrap_used, clippy::panic)]

use std::collections::BTreeMap;

use graph::{
    Alias, Editor, Flow, FlowName, Line, Manifest, Node, NodeId, PortName, Project, Variable,
    VariableName, VariableScope, VariableType,
};
use runtime::compile::{Code, Diagnostic, Report, compile};
use serde_json::{Value, json};

pub fn node(id: &str, alias: &str, kind: &str, settings: Value) -> Node {
    let Value::Object(settings) = settings else {
        panic!("settings must be an object");
    };
    Node {
        id: NodeId::parse(id).unwrap(),
        alias: Alias::parse(alias).unwrap(),
        kind: kind.to_owned(),
        type_version: 1,
        settings,
        editor: Editor { x: 0.0, y: 0.0 },
    }
}

pub fn slash(id: &str, alias: &str, name: &str) -> Node {
    node(
        id,
        alias,
        "discord.slash_command",
        json!({ "name": name, "description": "A command" }),
    )
}

pub fn reply(id: &str, alias: &str, content: &str) -> Node {
    node(id, alias, "discord.reply", json!({ "content": content }))
}

pub fn branch(id: &str, alias: &str, condition: &str) -> Node {
    node(id, alias, "logic.branch", json!({ "condition": condition }))
}

pub fn line(from: &str, port: &str, to: &str) -> Line {
    Line {
        from: graph::Port {
            node: NodeId::parse(from).unwrap(),
            port: PortName::parse(port).unwrap(),
        },
        to: NodeId::parse(to).unwrap(),
    }
}

pub fn flow(nodes: Vec<Node>, lines: Vec<Line>) -> Flow {
    Flow { nodes, lines }
}

pub fn project(flows: Vec<(&str, Flow)>) -> Project {
    Project {
        manifest: Manifest::new("test"),
        flows: flows
            .into_iter()
            .map(|(name, flow)| (FlowName::parse(name).unwrap(), flow))
            .collect::<BTreeMap<_, _>>(),
    }
}

/// A project with one flow named `main`.
pub fn single(nodes: Vec<Node>, lines: Vec<Line>) -> Project {
    project(vec![("main", flow(nodes, lines))])
}

pub fn declare(
    project: &mut Project,
    scope: VariableScope,
    name: &str,
    kind: VariableType,
    initial: Value,
) {
    project.manifest.variables.push(Variable {
        name: VariableName::parse(name).unwrap(),
        kind,
        scope,
        initial,
    });
}

pub fn run(project: &Project) -> Report {
    compile(project, "0.1.0")
}

pub fn codes(report: &Report) -> Vec<Code> {
    report.diagnostics.iter().map(|d| d.code).collect()
}

pub fn has(report: &Report, code: Code) -> bool {
    report.diagnostics.iter().any(|d| d.code == code)
}

/// The only diagnostic of `code`.
pub fn only(report: &Report, code: Code) -> &Diagnostic {
    let found: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| d.code == code)
        .collect();
    assert_eq!(
        found.len(),
        1,
        "expected one {code:?}, got {:#?}",
        report.diagnostics
    );
    found[0]
}

/// The Ping bot: `/ping` and a reply.
pub fn ping() -> Project {
    single(
        vec![
            slash("n1", "ping_command", "ping"),
            reply("n2", "reply", "Pong!"),
        ],
        vec![line("n1", "next", "n2")],
    )
}
