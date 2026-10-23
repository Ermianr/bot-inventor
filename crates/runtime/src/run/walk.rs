//! One run: the walk from the trigger, node by node.

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::nodes::{self, NodeCx, NodeError};
use crate::platform::{Event, Interaction, Platform};

use super::{Flow, Inner};

/// What a run holds while it walks (`docs/ARCHITECTURE.md` §5.1).
pub(crate) struct RunState {
    pub(crate) event: Value,
    /// `steps.<alias>.<output>` of the nodes that already ran.
    pub(crate) steps: Map<String, Value>,
    pub(crate) vars: Value,
    pub(crate) interaction: Option<Interaction>,
    /// Whether the interaction has its first response.
    pub(crate) responded: bool,
    /// Whether the replies are visible only to the user, as the command node says.
    pub(crate) ephemeral: bool,
    /// The node the run was at last, for the log.
    pub(super) at: Option<usize>,
}

impl RunState {
    pub(super) fn new(event: Event, vars: Value) -> Self {
        Self {
            event: event.data,
            steps: Map::new(),
            vars,
            interaction: event.interaction,
            responded: false,
            ephemeral: false,
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
pub(super) async fn walk<P: Platform>(
    inner: &Inner<P>,
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
        let mut cx = NodeCx {
            platform: &inner.platform,
            node,
            run: state,
            error: inherited.as_deref(),
        };
        let (port, error) = match nodes::execute(node.kind, &mut cx).await {
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
