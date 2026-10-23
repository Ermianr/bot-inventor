//! The deferral: two seconds without a response and the interaction is deferred
//! (`docs/ARCHITECTURE.md` §5.3). A slow storage stands in for a slow node.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::time::Duration;

use common::*;
use graph::{Project, Variable, VariableScope, VariableType};
use runtime::platform::{Action, Delivery, Interaction, PlatformError};
use runtime::run::Level;
use runtime::storage::{MemoryStorage, Storage, StorageError, StoredValue, VarKey, VarRef};
use serde_json::json;

/// A memory storage whose `add` takes `delay`, so the flow reaches its reply late.
struct Slow {
    inner: MemoryStorage,
    delay: Duration,
}

impl Slow {
    fn new(seconds: u64) -> Self {
        Self {
            inner: MemoryStorage::new(),
            delay: Duration::from_secs(seconds),
        }
    }
}

impl Storage for Slow {
    async fn check_variables(&self, declared: &[Variable]) -> Result<(), StorageError> {
        self.inner.check_variables(declared).await
    }
    async fn get_many(&self, keys: &[VarKey]) -> Result<Vec<Option<StoredValue>>, StorageError> {
        self.inner.get_many(keys).await
    }
    async fn set(&self, key: &VarKey, value: &StoredValue) -> Result<(), StorageError> {
        self.inner.set(key, value).await
    }
    async fn add(
        &self,
        key: &VarKey,
        initial: &StoredValue,
        delta: &StoredValue,
    ) -> Result<StoredValue, StorageError> {
        tokio::time::sleep(self.delay).await;
        self.inner.add(key, initial, delta).await
    }
    async fn reset_variable(&self, variable: &VarRef) -> Result<u64, StorageError> {
        self.inner.reset_variable(variable).await
    }
}

/// `/count` adds one to `server.visits` and then says `content`.
fn counter(content: &str, ephemeral: bool) -> Project {
    let mut project = single(
        vec![
            slash("n1", "s", "count"),
            set_variable("n2", "inc", "server.visits", "add", "1"),
            reply("n3", "say", content),
        ],
        vec![line("n1", "next", "n2"), line("n2", "next", "n3")],
    );
    project.flows.values_mut().next().unwrap().nodes[0]
        .settings
        .insert("ephemeral".to_owned(), json!(ephemeral));
    declare(
        &mut project,
        VariableScope::Server,
        "visits",
        VariableType::Integer,
        json!(0),
    );
    project
}

async fn slow_run(
    project: &Project,
    seconds: u64,
) -> (
    runtime::run::Runtime<runtime::platform::MockPlatform, Slow>,
    std::sync::Arc<runtime::run::MemoryLog>,
) {
    let storage = Slow::new(seconds);
    storage
        .check_variables(&project.manifest.variables)
        .await
        .unwrap();
    let (runtime, log) = start_stored(&payload(project), storage);
    runtime.dispatch(command_in("count", "1", "2"));
    runtime.drain().await;
    (runtime, log)
}

fn interaction() -> Interaction {
    Interaction {
        id: "i-1".to_owned(),
    }
}

#[tokio::test(start_paused = true)]
async fn a_reply_before_two_seconds_does_not_defer() {
    let (runtime, log) = slow_run(&counter("done", false), 1).await;
    // The timer must be gone with the run: nothing happens later.
    tokio::time::sleep(Duration::from_secs(10)).await;

    let actions = runtime.platform().actions();
    assert_eq!(actions.len(), 1, "{actions:?}");
    let sent = replies(&runtime);
    assert_eq!(sent[0].delivery, Delivery::Response);
    assert!(log.records().is_empty());
}

#[tokio::test(start_paused = true)]
async fn no_response_at_two_seconds_defers_once_and_the_reply_is_a_follow_up() {
    let (runtime, log) = slow_run(&counter("done", false), 3).await;

    let actions = runtime.platform().actions();
    assert_eq!(actions.len(), 2, "{actions:?}");
    assert_eq!(
        actions[0],
        Action::Defer {
            interaction: interaction(),
            ephemeral: false
        }
    );
    let sent = replies(&runtime);
    assert_eq!(sent[0].delivery, Delivery::FollowUp);
    assert!(!sent[0].ephemeral);
    assert!(log.records().is_empty());
}

#[tokio::test(start_paused = true)]
async fn the_deferral_keeps_the_visibility_of_the_command() {
    let (runtime, _) = slow_run(&counter("done", true), 3).await;

    let actions = runtime.platform().actions();
    assert_eq!(
        actions[0],
        Action::Defer {
            interaction: interaction(),
            ephemeral: true
        }
    );
    assert!(replies(&runtime)[0].ephemeral);
}

#[tokio::test(start_paused = true)]
async fn a_second_reply_after_a_deferral_is_one_more_follow_up() {
    let mut project = counter("one", false);
    let flow = project.flows.values_mut().next().unwrap();
    flow.nodes.push(reply("n4", "again", "two"));
    flow.lines.push(line("n3", "next", "n4"));
    let (runtime, _) = slow_run(&project, 3).await;

    let deliveries: Vec<_> = replies(&runtime).iter().map(|r| r.delivery).collect();
    assert_eq!(deliveries, [Delivery::FollowUp, Delivery::FollowUp]);
    let defers = runtime
        .platform()
        .actions()
        .iter()
        .filter(|action| matches!(action, Action::Defer { .. }))
        .count();
    assert_eq!(defers, 1);
}

#[tokio::test(start_paused = true)]
async fn a_failed_deferral_is_logged_and_the_reply_still_tries_to_respond() {
    let storage = Slow::new(3);
    let project = counter("done", false);
    storage
        .check_variables(&project.manifest.variables)
        .await
        .unwrap();
    let (runtime, log) = start_stored(&payload(&project), storage);
    runtime.platform().fail_next(PlatformError::Failed);
    runtime.dispatch(command_in("count", "1", "2"));
    runtime.drain().await;

    let actions = runtime.platform().actions();
    assert_eq!(actions.len(), 1, "{actions:?}");
    assert_eq!(replies(&runtime)[0].delivery, Delivery::Response);
    let records = log.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].level, Level::Warn);
    assert_eq!(records[0].message, "the interaction could not be deferred");
}

#[tokio::test(start_paused = true)]
async fn a_run_that_fails_after_a_deferral_tells_the_user_in_the_same_message() {
    // `1 / 0` fails when the reply is written, and no line leaves its `error` port.
    let (runtime, log) = slow_run(&counter("{{ 1 / 0 }}", false), 3).await;

    let actions = runtime.platform().actions();
    assert!(matches!(actions[0], Action::Defer { .. }), "{actions:?}");
    let sent = replies(&runtime);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].delivery, Delivery::FollowUp);
    assert!(sent[0].ephemeral);
    assert_eq!(log.records().len(), 1);
}
