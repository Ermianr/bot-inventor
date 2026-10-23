//! Variables in a run: reads, writes, the counter, scopes and the errors, on `MemoryStorage`.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::sync::{Arc, Mutex};

use common::*;
use graph::{Project, Variable, VariableName, VariableScope, VariableType};
use runtime::run::Level;
use runtime::storage::{
    MemoryStorage, Storage, StorageError, StoredScope, StoredValue, VarKey, VarRef,
};
use serde_json::{Value, json};

fn contents(replies: &[runtime::platform::Reply]) -> Vec<String> {
    replies.iter().map(|reply| reply.content.clone()).collect()
}

fn key(scope: StoredScope, owner: &str, name: &str) -> VarKey {
    VarKey {
        scope,
        key: owner.to_owned(),
        name: VariableName::parse(name).unwrap(),
    }
}

/// What the runner does before it starts: record the declared types in the storage.
async fn ready(project: &Project, storage: &MemoryStorage) {
    storage
        .check_variables(&project.manifest.variables)
        .await
        .unwrap();
}

/// `/count` adds one to `server.visits` and says the new total.
fn counter() -> Project {
    let mut project = single(
        vec![
            slash("n1", "s", "count"),
            set_variable("n2", "inc", "server.visits", "add", "1"),
            reply("n3", "say", "Visit {{ steps.inc.value }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    declare(
        &mut project,
        VariableScope::Server,
        "visits",
        VariableType::Integer,
        json!(0),
    );
    project
}

#[tokio::test]
async fn a_counter_counts_across_runs_and_across_a_restart() {
    let project = counter();
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let payload = payload(&project);

    let (runtime, _) = start_stored(&payload, storage.clone());
    let mut said = Vec::new();
    for _ in 0..3 {
        let replies = dispatch_and_wait(&runtime, command_in("count", "100", "42")).await;
        said.push(replies.last().unwrap().content.clone());
    }
    assert_eq!(said, ["Visit 1", "Visit 2", "Visit 3"]);
    drop(runtime);

    // The bot starts again on the same storage.
    let (runtime, _) = start_stored(&payload, storage.clone());
    let said = dispatch_and_wait(&runtime, command_in("count", "100", "42")).await;
    assert_eq!(contents(&said), ["Visit 4"]);
    // Another server has its own count.
    let said = dispatch_and_wait(&runtime, command_in("count", "101", "42")).await;
    assert_eq!(said.last().unwrap().content, "Visit 1");
}

#[tokio::test]
async fn runs_at_the_same_time_lose_no_count() {
    let project = counter();
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let (runtime, log) = start_stored(&payload(&project), storage.clone());
    for _ in 0..60 {
        assert_eq!(
            runtime.dispatch(command_in("count", "100", "42")).started,
            1
        );
    }
    runtime.drain().await;
    assert!(log.records().is_empty(), "{:?}", log.records());
    let total = storage
        .get_many(&[key(StoredScope::Server, "100", "visits")])
        .await
        .unwrap();
    assert_eq!(total, [Some(StoredValue::Integer(60))]);
    // Each run saw a different total.
    let mut seen = contents(&replies(&runtime));
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 60);
}

/// Two commands: `/add` raises `member.warnings` and `user.points`; `/show` reads them.
fn scopes() -> Project {
    let mut project = project(vec![
        (
            "add",
            flow(
                vec![
                    slash("a1", "s", "add"),
                    set_variable("a2", "w", "member.warnings", "add", "1"),
                    set_variable("a3", "p", "user.points", "add", "10"),
                ],
                vec![line("a1", "next", "a2"), line("a2", "next", "a3")],
            ),
        ),
        (
            "show",
            flow(
                vec![
                    slash("b1", "s", "show"),
                    reply(
                        "b2",
                        "r",
                        "{{ vars.member.warnings }}/{{ vars.user.points }}",
                    ),
                ],
                vec![line("b1", "next", "b2")],
            ),
        ),
    ]);
    declare(
        &mut project,
        VariableScope::Member,
        "warnings",
        VariableType::Integer,
        json!(0),
    );
    declare(
        &mut project,
        VariableScope::User,
        "points",
        VariableType::Integer,
        json!(0),
    );
    project
}

#[tokio::test]
async fn member_and_user_values_do_not_mix() {
    let project = scopes();
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let (runtime, log) = start_stored(&payload(&project), storage);
    // ana (42) twice in server 100, once in server 101; bob (43) once in server 100.
    for (guild, user) in [("100", "42"), ("100", "42"), ("101", "42"), ("100", "43")] {
        dispatch_and_wait(&runtime, command_in("add", guild, user)).await;
    }
    let mut shown = Vec::new();
    for (guild, user) in [("100", "42"), ("101", "42"), ("100", "43"), ("101", "43")] {
        let said = dispatch_and_wait(&runtime, command_in("show", guild, user)).await;
        shown.push(said.last().unwrap().content.clone());
    }
    // Warnings follow the member; points follow the user in every server.
    assert_eq!(shown, ["2/30", "1/30", "1/10", "0/10"]);
    assert!(log.records().is_empty());
}

/// A storage that counts what the runtime asks of the one it wraps.
#[derive(Clone, Default)]
struct Spy {
    inner: MemoryStorage,
    gets: Arc<Mutex<Vec<Vec<String>>>>,
    writes: Arc<Mutex<usize>>,
}

impl Spy {
    fn gets(&self) -> Vec<Vec<String>> {
        self.gets.lock().unwrap().clone()
    }
}

impl Storage for Spy {
    async fn check_variables(&self, declared: &[Variable]) -> Result<(), StorageError> {
        self.inner.check_variables(declared).await
    }

    async fn get_many(&self, keys: &[VarKey]) -> Result<Vec<Option<StoredValue>>, StorageError> {
        self.gets
            .lock()
            .unwrap()
            .push(keys.iter().map(VarKey::variable).collect());
        self.inner.get_many(keys).await
    }

    async fn set(&self, key: &VarKey, value: &StoredValue) -> Result<(), StorageError> {
        *self.writes.lock().unwrap() += 1;
        self.inner.set(key, value).await
    }

    async fn add(
        &self,
        key: &VarKey,
        initial: &StoredValue,
        delta: &StoredValue,
    ) -> Result<StoredValue, StorageError> {
        *self.writes.lock().unwrap() += 1;
        self.inner.add(key, initial, delta).await
    }

    async fn reset_variable(&self, variable: &VarRef) -> Result<u64, StorageError> {
        self.inner.reset_variable(variable).await
    }
}

#[tokio::test]
async fn the_variables_a_node_reads_come_in_one_batch_and_once_per_run() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            branch(
                "n2",
                "check",
                "vars.bot.a == 0 && vars.server.b == 0 && vars.user.c == 0 && vars.run.d == 0",
            ),
            reply("n3", "yes", "{{ vars.bot.a }}{{ vars.server.b }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "true", "n3")],
    );
    for (scope, name) in [
        (VariableScope::Bot, "a"),
        (VariableScope::Server, "b"),
        (VariableScope::User, "c"),
        (VariableScope::Run, "d"),
        (VariableScope::Member, "unused"),
    ] {
        declare(&mut project, scope, name, VariableType::Integer, json!(0));
    }
    let spy = Spy::default();
    spy.check_variables(&project.manifest.variables)
        .await
        .unwrap();
    let (runtime, log) = start_stored(&payload(&project), spy.clone());
    let said = dispatch_and_wait(&runtime, command_in("go", "100", "42")).await;
    assert_eq!(contents(&said), ["00"]);
    assert!(log.records().is_empty());
    // One batch for the branch: the three stored variables it reads, and not the `run` one nor
    // the one nobody reads. The reply reads two it already has.
    assert_eq!(spy.gets(), [["bot.a", "server.b", "user.c"]]);
}

#[tokio::test]
async fn a_reference_that_stops_before_the_name_reads_everything_under_it() {
    // Compile refuses `vars.bot` alone; a payload that skipped compile still reads whole.
    let mut project = single(
        vec![slash("n1", "s", "go"), branch("n2", "check", "true")],
        vec![line("n1", "next", "n2")],
    );
    for (scope, name) in [
        (VariableScope::Bot, "a"),
        (VariableScope::Bot, "b"),
        (VariableScope::Server, "c"),
        (VariableScope::Run, "d"),
    ] {
        declare(&mut project, scope, name, VariableType::Integer, json!(0));
    }
    for (source, expected) in [
        ("size(vars.bot) == 2", vec!["bot.a", "bot.b"]),
        ("size(vars) > 0", vec!["bot.a", "bot.b", "server.c"]),
        ("size(vars.server) == 1", vec!["server.c"]),
        ("size(vars.run) == 1", vec![]),
    ] {
        let mut payload = payload(&project);
        payload.flows[0].nodes[1].expressions[0].source = source.to_owned();
        let spy = Spy::default();
        spy.check_variables(&project.manifest.variables)
            .await
            .unwrap();
        let (runtime, log) = start_stored(&payload, spy.clone());
        dispatch_and_wait(&runtime, command_in("go", "100", "42")).await;
        assert!(log.records().is_empty(), "{source}: {:?}", log.records());
        let expected: Vec<Vec<String>> = if expected.is_empty() {
            vec![]
        } else {
            vec![expected.into_iter().map(str::to_owned).collect()]
        };
        assert_eq!(spy.gets(), expected, "{source}");
    }
}

#[tokio::test]
async fn the_writes_of_a_run_update_what_it_reads_without_going_back_to_the_storage() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            set_variable("n2", "put", "bot.motto", "set", "'hello'"),
            set_variable("n3", "more", "bot.n", "add", "5"),
            reply(
                "n4",
                "say",
                "{{ vars.bot.motto }} {{ vars.bot.n }} {{ steps.more.value }}",
            ),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "next", "n4"),
        ],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "motto",
        VariableType::Text,
        json!(""),
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "n",
        VariableType::Integer,
        json!(100),
    );
    let spy = Spy::default();
    spy.check_variables(&project.manifest.variables)
        .await
        .unwrap();
    let (runtime, _) = start_stored(&payload(&project), spy.clone());
    let said = dispatch_and_wait(&runtime, command("go")).await;
    // The counter starts from its declared value.
    assert_eq!(contents(&said), ["hello 105 105"]);
    assert!(spy.gets().is_empty(), "{:?}", spy.gets());
    assert_eq!(*spy.writes.lock().unwrap(), 2);
}

#[tokio::test]
async fn run_variables_live_and_die_with_the_run_and_never_reach_the_storage() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            reply("n2", "before", "{{ vars.run.tmp }}"),
            set_variable("n3", "put", "run.tmp", "set", "'changed'"),
            set_variable("n4", "more", "run.n", "add", "2"),
            set_variable("n5", "again", "run.n", "add", "2"),
            reply("n6", "after", "{{ vars.run.tmp }} {{ vars.run.n }}"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "next", "n4"),
            line("n4", "next", "n5"),
            line("n5", "next", "n6"),
        ],
    );
    declare(
        &mut project,
        VariableScope::Run,
        "tmp",
        VariableType::Text,
        json!("fresh"),
    );
    declare(
        &mut project,
        VariableScope::Run,
        "n",
        VariableType::Integer,
        json!(10),
    );
    let spy = Spy::default();
    let (runtime, _) = start_stored(&payload(&project), spy.clone());
    for _ in 0..2 {
        dispatch_and_wait(&runtime, command("go")).await;
    }
    // Every run starts again from the declared values.
    assert_eq!(
        contents(&replies(&runtime)),
        ["fresh", "changed 14", "fresh", "changed 14"]
    );
    assert!(spy.gets().is_empty());
    assert_eq!(*spy.writes.lock().unwrap(), 0);
}

#[tokio::test]
async fn nothing_stored_reads_as_the_declared_value_and_a_decimal_stays_a_decimal() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            reply(
                "n2",
                "r",
                "{{ vars.bot.ratio + 0.5 }} {{ vars.bot.n }} {{ vars.bot.on }} {{ vars.bot.motto }}",
            ),
        ],
        vec![line("n1", "next", "n2")],
    );
    // A whole number declared for a decimal.
    declare(
        &mut project,
        VariableScope::Bot,
        "ratio",
        VariableType::Decimal,
        json!(2),
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "n",
        VariableType::Integer,
        json!(7),
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "on",
        VariableType::Boolean,
        json!(true),
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "motto",
        VariableType::Text,
        json!("hi"),
    );
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let (runtime, log) = start_stored(&payload(&project), storage);
    let said = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(contents(&said), ["2.5 7 true hi"], "{:?}", log.records());
}

#[tokio::test]
async fn a_decimal_counter_adds_whole_numbers_too() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            set_variable("n2", "inc", "bot.ratio", "add", "1"),
            set_variable("n3", "inc2", "bot.ratio", "add", "0.25"),
            reply("n4", "say", "{{ steps.inc.value }} {{ steps.inc2.value }}"),
        ],
        vec![
            line("n1", "next", "n2"),
            line("n2", "next", "n3"),
            line("n3", "next", "n4"),
        ],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "ratio",
        VariableType::Decimal,
        json!(0.5),
    );
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let (runtime, log) = start_stored(&payload(&project), storage);
    let said = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(contents(&said), ["1.5 1.75"], "{:?}", log.records());
}

#[tokio::test]
async fn text_from_a_user_is_stored_and_shown_as_data_and_never_evaluated() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            set_variable("n2", "put", "user.last", "set", "event.user.name"),
            reply("n3", "say", "{{ vars.user.last }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    declare(
        &mut project,
        VariableScope::User,
        "last",
        VariableType::Text,
        json!(""),
    );
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let (runtime, _) = start_stored(&payload(&project), storage.clone());
    let mut event = command_in("go", "100", "42");
    event.data["user"]["name"] = json!("{{ 1 + 1 }} vars.bot.x");
    let said = dispatch_and_wait(&runtime, event).await;
    assert_eq!(contents(&said), ["{{ 1 + 1 }} vars.bot.x"]);
    let stored = storage
        .get_many(&[key(StoredScope::User, "42", "last")])
        .await
        .unwrap();
    assert_eq!(
        stored,
        [Some(StoredValue::Text("{{ 1 + 1 }} vars.bot.x".to_owned()))]
    );
}

// ---- Errors -----------------------------------------------------------------------------------

/// `/go` runs `set_variable`, whose `error` port says `error.kind: error.message`.
fn failing(
    variable: &str,
    operation: &str,
    value: &str,
    kind: VariableType,
    initial: Value,
) -> Project {
    let scope = variable.split('.').next().unwrap();
    let scope = match scope {
        "bot" => VariableScope::Bot,
        "server" => VariableScope::Server,
        "member" => VariableScope::Member,
        "user" => VariableScope::User,
        _ => VariableScope::Run,
    };
    let name = variable.split('.').nth(1).unwrap();
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            set_variable("n2", "put", variable, operation, value),
            reply("n3", "failed", "{{ error.kind }}: {{ error.message }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "error", "n3")],
    );
    declare(&mut project, scope, name, kind, initial);
    project
}

async fn says(
    project: &Project,
    storage: MemoryStorage,
    event: runtime::platform::Event,
) -> String {
    ready(project, &storage).await;
    let (runtime, log) = start_stored(&payload(project), storage);
    let said = dispatch_and_wait(&runtime, event).await;
    assert_eq!(said.len(), 1, "{said:?} {:?}", log.records());
    said[0].content.clone()
}

#[tokio::test]
async fn an_event_without_the_ids_a_scope_needs_fails_the_node() {
    for (variable, event, message) in [
        (
            "server.v",
            command("go"),
            "the event has no server id, which `server` variables need",
        ),
        (
            "member.v",
            command("go"),
            "the event has no server id, which `member` variables need",
        ),
        (
            "user.v",
            {
                let mut event = command("go");
                event.data["user"] = json!({ "name": "ana" });
                event
            },
            "the event has no user id, which `user` variables need",
        ),
        (
            "member.v",
            {
                let mut event = command_in("go", "100", "42");
                event.data["guild"]["id"] = json!("not-an-id");
                event
            },
            "the event has no server id, which `member` variables need",
        ),
        (
            "user.v",
            {
                let mut event = command_in("go", "100", "42");
                event.data["user"]["id"] = json!(42);
                event
            },
            "the event has no user id, which `user` variables need",
        ),
    ] {
        let project = failing(variable, "set", "1", VariableType::Integer, json!(0));
        let said = says(&project, MemoryStorage::new(), event).await;
        assert_eq!(said, format!("invalid_value: {message}"), "{variable}");
    }
}

#[tokio::test]
async fn the_bot_scope_needs_no_ids() {
    let project = failing("bot.v", "set", "1", VariableType::Integer, json!(0));
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    let (runtime, log) = start_stored(&payload(&project), storage);
    // No `error` port is followed: the node works, and the reply behind `error` never runs.
    let said = dispatch_and_wait(&runtime, command("go")).await;
    assert!(said.is_empty());
    assert!(log.records().is_empty());
}

#[tokio::test]
async fn a_value_of_the_wrong_type_fails_and_stores_nothing() {
    for (variable, kind, initial, value, part) in [
        (
            "bot.v",
            VariableType::Integer,
            json!(0),
            "'text'",
            "`value`: the value must be a whole number",
        ),
        (
            "bot.v",
            VariableType::Integer,
            json!(0),
            "1.5",
            "`value`: the value must be a whole number",
        ),
        (
            "bot.v",
            VariableType::Text,
            json!(""),
            "1",
            "`value`: the value must be text",
        ),
        (
            "bot.v",
            VariableType::Boolean,
            json!(false),
            "1",
            "`value`: the value must be true or false",
        ),
        (
            "bot.v",
            VariableType::Decimal,
            json!(0.5),
            "true",
            "`value`: the value must be a number",
        ),
        (
            "bot.v",
            VariableType::Text,
            json!(""),
            "'a' * 3",
            "evaluation failed",
        ),
    ] {
        let project = failing(variable, "set", value, kind, initial);
        let storage = MemoryStorage::new();
        let said = says(&project, storage.clone(), command("go")).await;
        assert!(said.contains(part), "{value}: {said}");
        assert!(
            said.starts_with("invalid_value") || said.starts_with("expression"),
            "{said}"
        );
        let stored = storage
            .get_many(&[key(StoredScope::Bot, "", "v")])
            .await
            .unwrap();
        assert_eq!(stored, [None]);
    }
}

#[tokio::test]
async fn a_text_that_is_too_long_fails() {
    let project = failing(
        "bot.v",
        "set",
        "'a'.size() == 1 ? event.user.name : ''",
        VariableType::Text,
        json!(""),
    );
    let mut event = command("go");
    event.data["user"]["name"] = json!("a".repeat(4001));
    let said = says(&project, MemoryStorage::new(), event).await;
    assert_eq!(
        said,
        "invalid_value: `value`: the text has too many characters"
    );
}

#[tokio::test]
async fn a_counter_that_would_overflow_fails_and_keeps_its_value() {
    let project = failing("bot.v", "add", "1", VariableType::Integer, json!(0));
    let storage = MemoryStorage::new();
    ready(&project, &storage).await;
    storage
        .set(
            &key(StoredScope::Bot, "", "v"),
            &StoredValue::Integer(i64::MAX),
        )
        .await
        .unwrap();
    let said = says(&project, storage.clone(), command("go")).await;
    assert_eq!(
        said,
        "invalid_value: the result does not fit in the variable"
    );
    let stored = storage
        .get_many(&[key(StoredScope::Bot, "", "v")])
        .await
        .unwrap();
    assert_eq!(stored, [Some(StoredValue::Integer(i64::MAX))]);
}

/// A storage whose every operation fails with a detail that must never reach a flow.
struct Broken;

impl Storage for Broken {
    async fn check_variables(&self, _: &[Variable]) -> Result<(), StorageError> {
        Ok(())
    }
    async fn get_many(&self, _: &[VarKey]) -> Result<Vec<Option<StoredValue>>, StorageError> {
        Err(StorageError::Database("SECRET-DETAIL".to_owned()))
    }
    async fn set(&self, _: &VarKey, _: &StoredValue) -> Result<(), StorageError> {
        Err(StorageError::Database("SECRET-DETAIL".to_owned()))
    }
    async fn add(
        &self,
        _: &VarKey,
        _: &StoredValue,
        _: &StoredValue,
    ) -> Result<StoredValue, StorageError> {
        Err(StorageError::Database("SECRET-DETAIL".to_owned()))
    }
    async fn reset_variable(&self, _: &VarRef) -> Result<u64, StorageError> {
        Err(StorageError::Closed)
    }
}

#[tokio::test]
async fn a_storage_that_fails_sends_the_run_to_the_error_port_without_its_detail() {
    // Writing.
    let writing = failing("bot.v", "add", "1", VariableType::Integer, json!(0));
    // Reading, in the node that reads the variable.
    let mut reading = single(
        vec![
            slash("n1", "s", "go"),
            branch("n2", "check", "vars.bot.v == 0"),
            reply("n3", "failed", "{{ error.kind }}: {{ error.message }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "error", "n3")],
    );
    declare(
        &mut reading,
        VariableScope::Bot,
        "v",
        VariableType::Integer,
        json!(0),
    );
    for project in [writing, reading] {
        let (runtime, log) = start_stored(&payload(&project), Broken);
        let said = dispatch_and_wait(&runtime, command("go")).await;
        assert_eq!(
            contents(&said),
            ["storage: the storage could not carry out the operation"]
        );
        assert!(log.records().is_empty());
    }
}

#[tokio::test]
async fn an_unhandled_storage_failure_gives_the_user_the_generic_message() {
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            set_variable("n2", "put", "bot.v", "add", "1"),
        ],
        vec![line("n1", "next", "n2")],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "v",
        VariableType::Integer,
        json!(0),
    );
    let (runtime, log) = start_stored(&payload(&project), Broken);
    let said = dispatch_and_wait(&runtime, command("go")).await;
    assert_eq!(contents(&said), [runtime::run::GENERIC_FAILURE_MESSAGE]);
    let records = log.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].level, Level::Error);
    assert!(records[0].message.contains("storage"), "{records:?}");
    assert!(!records[0].message.contains("SECRET"), "{records:?}");
}

#[tokio::test]
async fn a_value_stored_with_the_wrong_type_is_an_error_that_names_the_variable() {
    // A storage that was not checked against the declaration the runtime was built from.
    let mut project = single(
        vec![
            slash("n1", "s", "go"),
            branch("n2", "check", "vars.bot.v == 0"),
            reply("n3", "failed", "{{ error.kind }}: {{ error.message }}"),
        ],
        vec![line("n1", "next", "n2"), line("n2", "error", "n3")],
    );
    declare(
        &mut project,
        VariableScope::Bot,
        "v",
        VariableType::Integer,
        json!(0),
    );
    let storage = MemoryStorage::new();
    storage
        .check_variables(&[Variable {
            name: VariableName::parse("v").unwrap(),
            kind: VariableType::Text,
            scope: VariableScope::Bot,
            initial: json!(""),
        }])
        .await
        .unwrap();
    storage
        .set(
            &key(StoredScope::Bot, "", "v"),
            &StoredValue::Text("x".to_owned()),
        )
        .await
        .unwrap();
    let said = says_unchecked(&project, storage, command("go")).await;
    assert_eq!(
        said,
        "storage: the value stored for `bot.v` does not have its type"
    );
}

async fn says_unchecked(
    project: &Project,
    storage: MemoryStorage,
    event: runtime::platform::Event,
) -> String {
    let (runtime, _) = start_stored(&payload(project), storage);
    dispatch_and_wait(&runtime, event).await[0].content.clone()
}
