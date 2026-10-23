//! One run: the walk from the trigger, node by node.

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{Map, Value};
use tokio::sync::{Mutex, MutexGuard};

use crate::nodes::{self, NodeCx, NodeError};
use crate::platform::{Delivery, Event, Interaction, Platform};
use crate::storage::Storage;

use super::vars::{self, Loaded};
use super::{Flow, Inner};

/// Where the response to an interaction stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stage {
    /// Nothing was sent: the next message is the response.
    Pending,
    /// The user sees "thinking": the next message completes it.
    Deferred,
    /// The response was sent.
    Responded,
}

impl Stage {
    /// How the next message reaches the user.
    pub(crate) fn delivery(self) -> Delivery {
        match self {
            Self::Pending => Delivery::Response,
            Self::Deferred | Self::Responded => Delivery::FollowUp,
        }
    }
}

/// The response to the interaction of a run. The walk and the deferral timer share it: the stage
/// is behind an async lock that is held while a message is sent, so the timer never defers an
/// interaction whose response is on its way.
#[derive(Debug)]
pub(crate) struct Response {
    stage: Mutex<Stage>,
    /// Whether the messages are visible only to the user, as the command node says.
    ephemeral: AtomicBool,
}

impl Response {
    fn new() -> Self {
        Self {
            stage: Mutex::new(Stage::Pending),
            ephemeral: AtomicBool::new(false),
        }
    }

    pub(crate) async fn lock(&self) -> MutexGuard<'_, Stage> {
        self.stage.lock().await
    }

    pub(crate) fn ephemeral(&self) -> bool {
        self.ephemeral.load(Ordering::Relaxed)
    }

    pub(crate) fn set_ephemeral(&self, ephemeral: bool) {
        self.ephemeral.store(ephemeral, Ordering::Relaxed);
    }
}

/// What a run holds while it walks (`docs/ARCHITECTURE.md` §5.1).
pub(crate) struct RunState {
    pub(crate) event: Value,
    /// `steps.<alias>.<output>` of the nodes that already ran.
    pub(crate) steps: Map<String, Value>,
    pub(crate) vars: Value,
    /// Which persistent variables already have their stored value in `vars`.
    pub(super) loaded: Loaded,
    pub(crate) interaction: Option<Interaction>,
    pub(crate) response: Arc<Response>,
    /// The node the run was at last, for the log.
    pub(super) at: Option<usize>,
}

impl RunState {
    pub(super) fn new(event: Event, vars: Value) -> Self {
        Self {
            event: event.data,
            steps: Map::new(),
            vars,
            loaded: Loaded::default(),
            interaction: event.interaction,
            response: Arc::new(Response::new()),
            at: None,
        }
    }
}

/// How a walk ended, when it did end.
pub(super) enum Ending {
    Completed,
    /// A node failed and no line leaves its `error` port.
    Failed {
        node: usize,
        error: NodeError,
    },
    TooManySteps {
        node: usize,
    },
}

/// Walks `flow` from its trigger. A node runs at most once, after every node before it that is
/// going to run: nodes are in topological order, so the next one to run is always the one with
/// the lowest index. Each node counts as a step.
pub(super) async fn walk<P: Platform, S: Storage>(
    inner: &Inner<P, S>,
    flow: &Flow,
    state: &mut RunState,
) -> Ending {
    let mut queue = BinaryHeap::new();
    let mut queued = vec![false; flow.nodes.len()];
    let mut errors: Vec<Option<Arc<Value>>> = vec![None; flow.nodes.len()];
    queue.push(Reverse(flow.trigger));
    if let Some(slot) = queued.get_mut(flow.trigger) {
        *slot = true;
    }

    let mut steps = 0;
    while let Some(Reverse(at)) = queue.pop() {
        if steps >= inner.limits.max_steps {
            return Ending::TooManySteps { node: at };
        }
        steps += 1;
        state.at = Some(at);
        let Some(node) = flow.nodes.get(at) else {
            continue;
        };
        let inherited = errors.get(at).cloned().flatten();
        // The variables the node reads come from the storage in one batch, just before it runs.
        let outcome = match vars::load(&inner.storage, node, state).await {
            Ok(()) => {
                let mut cx = NodeCx {
                    platform: &inner.platform,
                    storage: &inner.storage,
                    decls: &inner.decls,
                    node,
                    run: state,
                    error: inherited.as_deref(),
                };
                nodes::execute(node.kind, &mut cx).await
            }
            Err(error) => Err(error),
        };
        let (port, error) = match outcome {
            Ok(outcome) => {
                if !outcome.outputs.is_empty() {
                    state
                        .steps
                        .insert(node.alias.clone(), Value::Object(outcome.outputs));
                }
                (outcome.port, inherited)
            }
            Err(error) => {
                if node.targets(crate::catalog::ERROR_PORT).is_empty() {
                    return Ending::Failed { node: at, error };
                }
                (crate::catalog::ERROR_PORT, Some(Arc::new(error.as_value())))
            }
        };
        for &target in node.targets(port) {
            let (Some(is_queued), Some(slot)) = (queued.get_mut(target), errors.get_mut(target))
            else {
                continue;
            };
            if slot.is_none() {
                slot.clone_from(&error);
            }
            if !*is_queued {
                *is_queued = true;
                queue.push(Reverse(target));
            }
        }
    }
    Ending::Completed
}
