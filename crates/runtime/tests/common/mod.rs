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

pub fn set_variable(id: &str, alias: &str, variable: &str, operation: &str, value: &str) -> Node {
    node(
        id,
        alias,
        "data.set_variable",
        json!({ "variable": variable, "operation": operation, "value": value }),
    )
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

// ---- Running a payload ------------------------------------------------------------------------

use std::sync::Arc;

use graph::Payload;
use runtime::platform::{Action, Event, Interaction, MockPlatform, Reply};
use runtime::run::{Limits, MemoryLog, Runtime};
use runtime::storage::Storage;

/// The payload of a project that compiles without errors.
pub fn payload(project: &Project) -> Payload {
    let report = run(project);
    assert!(!report.has_errors(), "{:#?}", report.diagnostics);
    report.payload.unwrap()
}

/// A runtime on a mock platform and a memory log, with the default limits.
pub fn start(payload: &Payload) -> (Runtime<MockPlatform>, Arc<MemoryLog>) {
    start_with(payload, Limits::default())
}

pub fn start_with(payload: &Payload, limits: Limits) -> (Runtime<MockPlatform>, Arc<MemoryLog>) {
    let log = Arc::new(MemoryLog::new());
    let runtime = Runtime::with(
        payload,
        MockPlatform::new(),
        log.clone(),
        &runtime::expr::CelEngine::new(),
        limits,
    )
    .unwrap();
    (runtime, log)
}

/// A runtime on a mock platform and the given storage, with the default limits.
pub fn start_stored<S: Storage>(
    payload: &Payload,
    storage: S,
) -> (Runtime<MockPlatform, S>, Arc<MemoryLog>) {
    let log = Arc::new(MemoryLog::new());
    let runtime = Runtime::with_storage(
        payload,
        MockPlatform::new(),
        storage,
        log.clone(),
        &runtime::expr::CelEngine::new(),
        Limits::default(),
    )
    .unwrap();
    (runtime, log)
}

/// A `/name` slash command from a user named `ana`.
pub fn command(name: &str) -> Event {
    Event {
        kind: "slash_command".to_owned(),
        command: Some(name.to_owned()),
        data: json!({
            "command": { "name": name },
            "user": { "id": "42", "name": "ana" },
            "options": {},
        }),
        interaction: Some(Interaction {
            id: "i-1".to_owned(),
        }),
    }
}

/// Like [`command`], used in a server: `guild` and `user` are Discord ids.
pub fn command_in(name: &str, guild: &str, user: &str) -> Event {
    let mut event = command(name);
    event.data["guild"] = json!({ "id": guild });
    event.data["user"]["id"] = json!(user);
    event
}

/// The replies the mock platform carried out.
pub fn replies<S: Storage>(runtime: &Runtime<MockPlatform, S>) -> Vec<Reply> {
    runtime
        .platform()
        .actions()
        .into_iter()
        .filter_map(|action| match action {
            Action::Reply(reply) => Some(reply),
            Action::Defer { .. } => None,
        })
        .collect()
}

/// Dispatches `event`, waits for the runs to end and returns the replies.
pub async fn dispatch_and_wait<S: Storage>(
    runtime: &Runtime<MockPlatform, S>,
    event: Event,
) -> Vec<Reply> {
    runtime.dispatch(event);
    runtime.drain().await;
    replies(runtime)
}

/// A chain `slash -> reply -> reply -> ...` of `nodes` nodes in all.
pub fn chain(nodes: usize) -> Project {
    let mut list = vec![slash("n0", "start", "go")];
    let mut lines = Vec::new();
    for i in 1..nodes {
        list.push(reply(&format!("n{i}"), &format!("r{i}"), "ok"));
        lines.push(line(&format!("n{}", i - 1), "next", &format!("n{i}")));
    }
    single(list, lines)
}
