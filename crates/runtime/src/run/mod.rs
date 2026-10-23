//! The run executor: events in, runs out (`docs/ARCHITECTURE.md` §5).
//!
//! A [`Runtime`] holds a payload with its expressions compiled. [`Runtime::dispatch`] looks up
//! the flows an event starts and runs each one as its own task, within the limits of
//! [`Limits`]. What happens to a run is written to a [`RunLog`]; what it does to the world goes
//! through the [`Platform`] and what it keeps between runs through the [`Storage`].

mod log;
mod prepare;
pub(crate) mod vars;
mod walk;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use graph::Payload;
use serde_json::Value;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;

pub use log::{Level, LogRecord, MemoryLog, NoLog, RunLog};
pub(crate) use prepare::{Compiled, Flow, PreparedNode};
pub(crate) use vars::{Declarations, Declared};
pub(crate) use walk::{Response, RunState, Stage};

use crate::catalog::Registry;
use crate::expr::{CelEngine, ExpressionEngine};
use crate::platform::{AllowedMentions, Event, Interaction, Platform, Reply};
use crate::storage::{MemoryStorage, Storage};
use walk::Ending;

/// What a user sees when a run fails and nothing handles the error. It says nothing about why.
pub const GENERIC_FAILURE_MESSAGE: &str = "Something went wrong. Please try again later.";

/// How long a run may go without a response before the interaction is deferred. Discord wants
/// the first response within 3 seconds (`docs/ARCHITECTURE.md` §5.3).
const DEFER_AFTER: Duration = Duration::from_secs(2);

/// How long the deferral may take before it is given up; the deadline is 1 second away.
const DEFER_TIMEOUT: Duration = Duration::from_secs(1);

/// How long the generic message may take to send before it is given up.
const GENERIC_REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// The limits that stop a runaway bot. The values are provisional **[measure]**
/// (`docs/ARCHITECTURE.md` §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Runs in progress at the same time, across all flows. An event past this is dropped.
    pub max_runs: u32,
    /// Nodes one run may execute.
    pub max_steps: usize,
    /// How long one run may take.
    pub max_duration: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_runs: 64,
            max_steps: 500,
            max_duration: Duration::from_secs(60),
        }
    }
}

/// Why a payload cannot be run.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RuntimeError {
    #[error("flow `{flow}`, node `{node}`: the node type or its version is not known")]
    UnknownNode { flow: String, node: String },
    #[error("flow `{flow}`: the trigger is not a trigger node")]
    NotATrigger { flow: String },
    #[error("flow `{flow}`, node `{node}`, `{path}`: {reason}")]
    BadExpression {
        flow: String,
        node: String,
        path: String,
        reason: String,
    },
    #[error("the limit of simultaneous runs must be at least 1")]
    NoRuns,
}

/// What [`Runtime::dispatch`] did with an event.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Dispatch {
    /// Runs started.
    pub started: usize,
    /// Runs refused because the limit of simultaneous runs was reached.
    pub dropped: usize,
}

/// A compiled bot ready to run.
pub struct Runtime<P: Platform, S: Storage = MemoryStorage> {
    inner: Arc<Inner<P, S>>,
}

struct Inner<P, S> {
    platform: P,
    storage: S,
    log: Arc<dyn RunLog>,
    limits: Limits,
    flows: Vec<Flow>,
    /// Slash command name to flow.
    commands: HashMap<String, usize>,
    /// Event kind to flows.
    routes: HashMap<String, Vec<usize>>,
    decls: Declarations,
    /// The `vars` namespace a run starts with: every variable at its initial value.
    vars: Value,
    permits: Arc<Semaphore>,
}

impl<P: Platform> Runtime<P> {
    /// Prepares `payload` with the nodes the app ships, the default limits and the variables kept
    /// in memory.
    ///
    /// # Errors
    ///
    /// [`RuntimeError`] when a node or an expression of the payload cannot be run.
    pub fn new(payload: &Payload, platform: P, log: Arc<dyn RunLog>) -> Result<Self, RuntimeError> {
        Self::with(payload, platform, log, &CelEngine::new(), Limits::default())
    }

    /// Like [`new`](Self::new), with the expression engine and the limits given.
    ///
    /// # Errors
    ///
    /// [`RuntimeError`] when a node or an expression of the payload cannot be run, or the limits
    /// allow no run.
    pub fn with(
        payload: &Payload,
        platform: P,
        log: Arc<dyn RunLog>,
        engine: &dyn ExpressionEngine,
        limits: Limits,
    ) -> Result<Self, RuntimeError> {
        Runtime::with_storage(payload, platform, MemoryStorage::new(), log, engine, limits)
    }
}

impl<P: Platform, S: Storage> Runtime<P, S> {
    /// Like [`with`](Runtime::with), with the storage the variables are kept in. The caller has
    /// run [`Storage::check_variables`] on it for the variables of `payload`.
    ///
    /// # Errors
    ///
    /// [`RuntimeError`] when a node or an expression of the payload cannot be run, or the limits
    /// allow no run.
    pub fn with_storage(
        payload: &Payload,
        platform: P,
        storage: S,
        log: Arc<dyn RunLog>,
        engine: &dyn ExpressionEngine,
        limits: Limits,
    ) -> Result<Self, RuntimeError> {
        if limits.max_runs == 0 {
            return Err(RuntimeError::NoRuns);
        }
        let decls = Declarations::new(&payload.variables);
        let flows = prepare::flows(payload, &Registry::builtin(), engine, &decls)?;
        let mut commands = HashMap::new();
        for command in &payload.commands {
            if let Ok(flow) = usize::try_from(command.flow) {
                commands.insert(command.name.clone(), flow);
            }
        }
        let mut routes: HashMap<String, Vec<usize>> = HashMap::new();
        for route in &payload.events {
            routes.insert(
                route.event.clone(),
                route
                    .flows
                    .iter()
                    .filter_map(|&flow| usize::try_from(flow).ok())
                    .collect(),
            );
        }
        let permits = Arc::new(Semaphore::new(
            usize::try_from(limits.max_runs).unwrap_or(usize::MAX),
        ));
        Ok(Self {
            inner: Arc::new(Inner {
                platform,
                storage,
                log,
                limits,
                flows,
                commands,
                routes,
                vars: decls.namespace(),
                decls,
                permits,
            }),
        })
    }

    #[must_use]
    pub fn platform(&self) -> &P {
        &self.inner.platform
    }

    #[must_use]
    pub fn storage(&self) -> &S {
        &self.inner.storage
    }

    /// Starts a run for each flow the event starts, as tasks of the current tokio runtime.
    /// A slash command starts the flow of that command; any other event, the flows its kind is
    /// routed to. Returns at once.
    pub fn dispatch(&self, event: Event) -> Dispatch {
        let inner = &self.inner;
        let flows: Vec<usize> = match (event.kind.as_str(), &event.command) {
            ("slash_command", Some(name)) => {
                inner.commands.get(name).copied().into_iter().collect()
            }
            ("slash_command", None) => Vec::new(),
            (kind, _) => inner.routes.get(kind).cloned().unwrap_or_default(),
        };
        let mut result = Dispatch::default();
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            inner.warn(
                None,
                None,
                "an event arrived outside an async runtime and was dropped",
            );
            return result;
        };
        for flow in flows {
            let Some(name) = inner.flows.get(flow).map(|flow| flow.name.clone()) else {
                continue;
            };
            let Ok(permit) = Arc::clone(&inner.permits).try_acquire_owned() else {
                inner.warn(
                    Some(name),
                    None,
                    &format!(
                        "a run was dropped: {} runs are already in progress",
                        inner.limits.max_runs
                    ),
                );
                result.dropped += 1;
                continue;
            };
            let inner = Arc::clone(inner);
            let event = event.clone();
            handle.spawn(async move {
                inner.run(flow, event).await;
                drop(permit);
            });
            result.started += 1;
        }
        result
    }

    /// Waits until no run is in progress.
    pub async fn drain(&self) {
        let all = self.inner.limits.max_runs;
        // The semaphore is never closed, so the wait only ends when every permit is back.
        let _ = self.inner.permits.acquire_many(all).await;
    }
}

impl<P: Platform, S: Storage> Inner<P, S> {
    fn warn(&self, flow: Option<String>, node: Option<String>, message: &str) {
        self.log.record(LogRecord {
            level: Level::Warn,
            flow,
            node,
            message: message.to_owned(),
        });
    }

    async fn run(self: &Arc<Self>, flow_index: usize, event: Event) {
        let Some(flow) = self.flows.get(flow_index) else {
            return;
        };
        let mut state = RunState::new(event, self.vars.clone());
        let _timer = state.interaction.clone().map(|interaction| {
            DeferTimer(tokio::spawn(defer_later(
                Arc::clone(self),
                flow.name.clone(),
                interaction,
                Arc::clone(&state.response),
            )))
        });
        let ending =
            tokio::time::timeout(self.limits.max_duration, walk::walk(self, flow, &mut state))
                .await;
        let node_id = |at: Option<usize>| {
            at.and_then(|at| flow.nodes.get(at))
                .map(|node| node.id.clone())
        };
        let failed = match ending {
            Ok(Ending::Completed) => false,
            Ok(Ending::Failed { node, error }) => {
                self.log.record(LogRecord {
                    level: Level::Error,
                    flow: Some(flow.name.clone()),
                    node: node_id(Some(node)),
                    message: format!(
                        "the run failed and no line leaves the `error` port: {}: {}",
                        error.kind.as_str(),
                        error.message
                    ),
                });
                true
            }
            Ok(Ending::TooManySteps { node }) => {
                self.log.record(LogRecord {
                    level: Level::Warn,
                    flow: Some(flow.name.clone()),
                    node: node_id(Some(node)),
                    message: format!(
                        "the run was stopped: it passed the limit of {} steps",
                        self.limits.max_steps
                    ),
                });
                true
            }
            Err(_elapsed) => {
                self.log.record(LogRecord {
                    level: Level::Warn,
                    flow: Some(flow.name.clone()),
                    node: node_id(state.at),
                    message: format!(
                        "the run was stopped: it passed the limit of {} seconds",
                        self.limits.max_duration.as_secs()
                    ),
                });
                true
            }
        };
        if failed {
            self.tell_user(flow, &state).await;
        }
    }

    /// The user is still waiting for a response: send the generic message, with no detail.
    async fn tell_user(&self, flow: &Flow, state: &RunState) {
        let Some(interaction) = state.interaction.clone() else {
            return;
        };
        let mut stage = state.response.lock().await;
        if *stage == Stage::Responded {
            return;
        }
        let sent = tokio::time::timeout(
            GENERIC_REPLY_TIMEOUT,
            self.platform.reply(Reply {
                interaction,
                content: GENERIC_FAILURE_MESSAGE.to_owned(),
                ephemeral: true,
                mentions: AllowedMentions::default(),
                delivery: stage.delivery(),
            }),
        )
        .await;
        if matches!(sent, Ok(Ok(_))) {
            *stage = Stage::Responded;
        } else {
            self.warn(
                Some(flow.name.clone()),
                None,
                "the generic failure message could not be sent",
            );
        }
    }
}

/// Stops the deferral timer when the run ends.
struct DeferTimer(JoinHandle<()>);

impl Drop for DeferTimer {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Defers the interaction if the run has not responded by [`DEFER_AFTER`]. A deferral that fails
/// is logged and the run goes on: its reply still tries to be the response.
async fn defer_later<P: Platform, S: Storage>(
    inner: Arc<Inner<P, S>>,
    flow: String,
    interaction: Interaction,
    response: Arc<Response>,
) {
    tokio::time::sleep(DEFER_AFTER).await;
    let mut stage = response.lock().await;
    if *stage != Stage::Pending {
        return;
    }
    let deferred = tokio::time::timeout(
        DEFER_TIMEOUT,
        inner.platform.defer(interaction, response.ephemeral()),
    )
    .await;
    if matches!(deferred, Ok(Ok(()))) {
        *stage = Stage::Deferred;
    } else {
        inner.warn(Some(flow), None, "the interaction could not be deferred");
    }
}
