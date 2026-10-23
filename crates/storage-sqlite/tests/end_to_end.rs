//! A bot with a counter, run by the runtime on a real SQLite file.
#![allow(clippy::unwrap_used, clippy::panic)]

use std::collections::BTreeMap;
use std::sync::Arc;

use runtime::compile::compile;
use runtime::expr::CelEngine;
use runtime::graph::{
    Alias, Editor, Flow, FlowName, Line, Manifest, Node, NodeId, Payload, PortName, Project,
    Variable, VariableName, VariableScope, VariableType,
};
use runtime::platform::{Event, Interaction, MockPlatform, Reply};
use runtime::run::{Limits, MemoryLog, Runtime};
use runtime::storage::{Storage, StorageError};
use serde_json::{Value, json};
use storage_sqlite::SqliteStorage;
use tempfile::TempDir;

fn node(id: &str, alias: &str, kind: &str, settings: Value) -> Node {
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

fn line(from: &str, to: &str) -> Line {
    Line {
        from: runtime::graph::Port {
            node: NodeId::parse(from).unwrap(),
            port: PortName::parse("next").unwrap(),
        },
        to: NodeId::parse(to).unwrap(),
    }
}

fn variable(kind: VariableType, initial: Value) -> Variable {
    Variable {
        name: VariableName::parse("visits").unwrap(),
        kind,
        scope: VariableScope::Server,
        initial,
    }
}

/// `/count` adds one to `server.visits` and says the new total.
fn project(visits: Variable) -> Project {
    let flow = Flow {
        nodes: vec![
            node(
                "n1",
                "start",
                "discord.slash_command",
                json!({ "name": "count", "description": "Counts" }),
            ),
            node(
                "n2",
                "inc",
                "data.set_variable",
                json!({ "variable": "server.visits", "operation": "add", "value": "1" }),
            ),
            node(
                "n3",
                "say",
                "discord.reply",
                json!({ "content": "Visit {{ steps.inc.value }}" }),
            ),
        ],
        lines: vec![line("n1", "n2"), line("n2", "n3")],
    };
    let mut manifest = Manifest::new("counter");
    manifest.variables.push(visits);
    Project {
        manifest,
        flows: BTreeMap::from([(FlowName::parse("main").unwrap(), flow)]),
    }
}

fn payload(visits: Variable) -> Payload {
    let report = compile(&project(visits), "0.1.0");
    assert!(!report.has_errors(), "{:#?}", report.diagnostics);
    report.payload.unwrap()
}

fn event(guild: &str) -> Event {
    Event {
        kind: "slash_command".to_owned(),
        command: Some("count".to_owned()),
        data: json!({
            "command": { "name": "count" },
            "user": { "id": "42", "name": "ana" },
            "guild": { "id": guild },
            "options": {},
        }),
        interaction: Some(Interaction {
            id: "i-1".to_owned(),
        }),
    }
}

/// What the runner does: open the file, record the declared types, start the runtime.
async fn start(
    dir: &TempDir,
    payload: &Payload,
) -> Result<(Runtime<MockPlatform, SqliteStorage>, Arc<MemoryLog>), StorageError> {
    let storage = SqliteStorage::open(&dir.path().join("bot.sqlite"))?;
    storage.check_variables(&payload.variables).await?;
    let log = Arc::new(MemoryLog::new());
    let runtime = Runtime::with_storage(
        payload,
        MockPlatform::new(),
        storage,
        log.clone(),
        &CelEngine::new(),
        Limits::default(),
    )
    .unwrap();
    Ok((runtime, log))
}

async fn say(runtime: &Runtime<MockPlatform, SqliteStorage>, guild: &str) -> String {
    runtime.dispatch(event(guild));
    runtime.drain().await;
    let replies: Vec<Reply> = runtime
        .platform()
        .actions()
        .into_iter()
        .filter_map(|action| match action {
            runtime::platform::Action::Reply(reply) => Some(reply),
            runtime::platform::Action::Defer { .. } => None,
        })
        .collect();
    replies.last().unwrap().content.clone()
}

#[tokio::test]
async fn the_count_survives_a_restart_of_the_bot() {
    let dir = TempDir::new().unwrap();
    let payload = payload(variable(VariableType::Integer, json!(0)));
    {
        let (runtime, log) = start(&dir, &payload).await.unwrap();
        assert_eq!(say(&runtime, "100").await, "Visit 1");
        assert_eq!(say(&runtime, "100").await, "Visit 2");
        assert_eq!(say(&runtime, "101").await, "Visit 1");
        assert!(log.records().is_empty());
    }
    let (runtime, log) = start(&dir, &payload).await.unwrap();
    assert_eq!(say(&runtime, "100").await, "Visit 3");
    assert_eq!(say(&runtime, "101").await, "Visit 2");
    assert!(log.records().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn runs_at_the_same_time_lose_no_count() {
    let dir = TempDir::new().unwrap();
    let payload = payload(variable(VariableType::Integer, json!(0)));
    {
        let (runtime, log) = start(&dir, &payload).await.unwrap();
        for _ in 0..60 {
            assert_eq!(runtime.dispatch(event("100")).started, 1);
        }
        runtime.drain().await;
        assert!(log.records().is_empty(), "{:?}", log.records());
        let mut totals: Vec<String> = runtime
            .platform()
            .actions()
            .into_iter()
            .filter_map(|action| match action {
                runtime::platform::Action::Reply(reply) => Some(reply.content),
                runtime::platform::Action::Defer { .. } => None,
            })
            .collect();
        totals.sort();
        totals.dedup();
        assert_eq!(totals.len(), 60);
    }
    let (runtime, _) = start(&dir, &payload).await.unwrap();
    assert_eq!(say(&runtime, "100").await, "Visit 61");
}

#[tokio::test]
async fn changing_the_type_of_a_stored_variable_stops_the_start_and_a_reset_allows_it() {
    let dir = TempDir::new().unwrap();
    {
        let payload = payload(variable(VariableType::Integer, json!(0)));
        let (runtime, _) = start(&dir, &payload).await.unwrap();
        say(&runtime, "100").await;
    }
    // Integer to decimal: the bot starts and the count goes on.
    let decimal = payload(variable(VariableType::Decimal, json!(0)));
    {
        let (runtime, _) = start(&dir, &decimal).await.unwrap();
        assert_eq!(say(&runtime, "100").await, "Visit 2.0");
    }
    // Decimal to text is refused, and the message says what to do.
    let mut text = decimal.clone();
    text.variables = vec![variable(VariableType::Text, json!(""))];
    let error = start(&dir, &text).await.err().unwrap();
    assert!(error.to_string().contains("server.visits"), "{error}");
    assert!(error.to_string().contains("--reset-variable server.visits"));
    // The reset deletes the values, and then the new type can be declared.
    let storage = SqliteStorage::open(&dir.path().join("bot.sqlite")).unwrap();
    let deleted = storage
        .reset_variable(&"server.visits".parse().unwrap())
        .await
        .unwrap();
    assert_eq!(deleted, 1);
    drop(storage);
    assert!(start(&dir, &text).await.is_ok());
}
