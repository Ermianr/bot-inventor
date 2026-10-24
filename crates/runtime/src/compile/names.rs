//! The names a node can read: what the condition builder offers in its lists.
//!
//! The answer comes from the same facts compile uses to check a reference, so a name that is
//! offered is a name compile accepts at that node, and one that is not offered is a name it
//! reports (`tests/names.rs` checks both).

use graph::{FlowName, NodeId, Project, VariableType};

use super::declared_kinds;
use super::paths::{Paths, Presence};
use super::structure;
use crate::catalog::{Registry, ValueKind};
use crate::expr::name_source;

/// Why the names of a node cannot be listed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum NamesError {
    #[error("the project has no such flow")]
    UnknownFlow,
    #[error("the flow has no such node")]
    UnknownNode,
}

/// Where a name comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub enum NameGroup {
    Event,
    Step,
    Variable,
    Error,
}

/// Whether a name exists on every path to the node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub enum Availability {
    Always,
    /// On only some of the paths: compile warns where it is read.
    Sometimes,
}

/// One name that can be read.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct NameInfo {
    pub group: NameGroup,
    /// `["event", "options", "reason"]`.
    pub segments: Vec<String>,
    /// The name as it is written in an expression.
    pub source: String,
    pub kind: ValueKind,
    pub availability: Availability,
    /// The field may be missing at run time, as an option the command does not require; read it
    /// only after a presence test.
    pub optional: bool,
}

/// The names a node can read.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct NameList {
    /// Whether the flow is sound enough to know which steps run before the node. When it is
    /// not, there are no `steps` and no `error` names, and the flow's diagnostics say why.
    pub order_known: bool,
    pub names: Vec<NameInfo>,
}

/// The names that an expression or template of `node` can read, in the order the lists show
/// them: the event, the steps from the trigger on, the variables, then `error`.
///
/// # Errors
///
/// [`NamesError`] when the flow or the node does not exist.
pub fn expression_names(
    registry: &Registry,
    project: &Project,
    flow: &FlowName,
    node: &NodeId,
) -> Result<NameList, NamesError> {
    let flow_data = project.flows.get(flow).ok_or(NamesError::UnknownFlow)?;
    let graph = structure::analyze(flow, flow_data, registry, &mut Vec::new());
    let position = *graph
        .index
        .get(node.as_str())
        .ok_or(NamesError::UnknownNode)?;
    let mut names = Vec::new();

    if let Some(trigger) = graph.trigger
        && let Some(spec) = graph.specs[trigger].and_then(|spec| spec.trigger.as_ref())
    {
        for field in spec.event_names(&graph.node(trigger).settings) {
            let mut segments = vec!["event".to_owned()];
            segments.extend(field.segments);
            names.push(info(
                NameGroup::Event,
                segments,
                field.kind,
                Availability::Always,
                field.optional,
            ));
        }
    }

    let paths = Paths::new(&graph);
    if let Some(paths) = &paths {
        for &step in &graph.order {
            let Some(spec) = graph.specs[step] else {
                continue;
            };
            let availability = match paths.step_before(step, position) {
                Presence::Always => Availability::Always,
                Presence::Sometimes => Availability::Sometimes,
                Presence::Never => continue,
            };
            for output in spec.outputs {
                let alias = graph.node(step).alias.as_str();
                let segments = vec!["steps".to_owned(), alias.to_owned(), output.name.to_owned()];
                names.push(info(
                    NameGroup::Step,
                    segments,
                    output.kind,
                    availability,
                    false,
                ));
            }
        }
    }

    let kinds = declared_kinds(&project.manifest.variables);
    let mut declared: Vec<_> = kinds.iter().collect();
    declared.sort_by(|a, b| a.0.cmp(b.0));
    for (key, kind) in declared {
        let Some((scope, name)) = key.split_once('.') else {
            continue;
        };
        let kind = match kind {
            VariableType::Integer => ValueKind::Integer,
            VariableType::Decimal => ValueKind::Decimal,
            VariableType::Text => ValueKind::Text,
            VariableType::Boolean => ValueKind::Boolean,
        };
        let segments = vec!["vars".to_owned(), scope.to_owned(), name.to_owned()];
        names.push(info(
            NameGroup::Variable,
            segments,
            kind,
            Availability::Always,
            false,
        ));
    }

    if let Some(paths) = &paths {
        let availability = match paths.error_available(position) {
            Presence::Always => Some(Availability::Always),
            Presence::Sometimes => Some(Availability::Sometimes),
            Presence::Never => None,
        };
        if let Some(availability) = availability {
            for field in ["kind", "message"] {
                let segments = vec!["error".to_owned(), field.to_owned()];
                names.push(info(
                    NameGroup::Error,
                    segments,
                    ValueKind::Text,
                    availability,
                    false,
                ));
            }
        }
    }

    Ok(NameList {
        order_known: paths.is_some(),
        names,
    })
}

fn info(
    group: NameGroup,
    segments: Vec<String>,
    kind: ValueKind,
    availability: Availability,
    optional: bool,
) -> NameInfo {
    NameInfo {
        group,
        source: name_source(&segments),
        segments,
        kind,
        availability,
        optional,
    }
}
