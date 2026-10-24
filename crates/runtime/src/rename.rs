//! Renaming a node: its alias and every read of `steps.<alias>` in the flow.
//!
//! The reads are found by parsing each expression and template of the flow's nodes
//! ([`ExpressionEngine::rename_step`]), not by searching the text, so a string that happens to
//! say `steps.old` or a longer alias is left alone (`docs/ARCHITECTURE.md` §4.2). A field that
//! cannot be rewritten with certainty, such as an expression that does not compile yet, is left
//! as it is and reported; compile then marks the read that no longer points at a node.

use graph::{Alias, FlowName, NodeId, Project};
use serde_json::{Map, Value};

use crate::catalog::{FieldKind, FieldSpec, Registry};
use crate::expr::{ExpressionEngine, rename_step_in_template};

/// Why a node could not be renamed. Nothing is changed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RenameError {
    #[error("the project has no such flow")]
    UnknownFlow,
    #[error("the flow has no such node")]
    UnknownNode,
    #[error("{0}")]
    InvalidAlias(String),
    #[error("another node of this flow already has that alias")]
    AliasTaken,
}

/// The project after a rename, and what happened to each field that read the old alias.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct Renamed {
    pub project: Project,
    /// The fields whose reads now say the new alias.
    pub rewritten: Vec<FieldRef>,
    /// The fields that were left as they were, with the reason.
    pub left_alone: Vec<LeftAlone>,
}

/// A setting of a node of the flow.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct FieldRef {
    pub node: NodeId,
    /// The path inside the settings, as in a diagnostic: `condition`, `options[0].name`.
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct LeftAlone {
    pub field: FieldRef,
    pub reason: String,
}

/// Gives the node `node` of `flow` the alias `alias` and rewrites the reads of the old one.
///
/// # Errors
///
/// [`RenameError`] when the flow or the node does not exist, the alias is not valid or another
/// node of the flow has it.
pub fn rename_alias(
    registry: &Registry,
    engine: &dyn ExpressionEngine,
    project: &Project,
    flow: &FlowName,
    node: &NodeId,
    alias: &str,
) -> Result<Renamed, RenameError> {
    let new = Alias::parse(alias).map_err(|e| RenameError::InvalidAlias(e.to_string()))?;
    let mut out = project.clone();
    let nodes = &mut out
        .flows
        .get_mut(flow)
        .ok_or(RenameError::UnknownFlow)?
        .nodes;
    let target = nodes
        .iter()
        .position(|n| &n.id == node)
        .ok_or(RenameError::UnknownNode)?;
    let old = nodes[target].alias.clone();
    let mut rewritten = Vec::new();
    let mut left_alone = Vec::new();
    if old != new {
        if nodes.iter().any(|n| n.alias == new) {
            return Err(RenameError::AliasTaken);
        }
        nodes[target].alias = new.clone();
        for other in nodes.iter_mut() {
            let Ok(spec) = registry.get(&other.kind, other.type_version) else {
                continue;
            };
            let mut walk = Walk {
                engine,
                from: old.as_str(),
                to: new.as_str(),
                node: &other.id,
                rewritten: &mut rewritten,
                left_alone: &mut left_alone,
            };
            walk.object(&mut other.settings, spec.fields, "");
        }
    }
    Ok(Renamed {
        project: out,
        rewritten,
        left_alone,
    })
}

struct Walk<'a> {
    engine: &'a dyn ExpressionEngine,
    from: &'a str,
    to: &'a str,
    node: &'a NodeId,
    rewritten: &'a mut Vec<FieldRef>,
    left_alone: &'a mut Vec<LeftAlone>,
}

impl Walk<'_> {
    fn object(&mut self, map: &mut Map<String, Value>, fields: &[FieldSpec], prefix: &str) {
        for field in fields {
            let Some(value) = map.get_mut(field.name) else {
                continue;
            };
            let path = if prefix.is_empty() {
                field.name.to_owned()
            } else {
                format!("{prefix}.{}", field.name)
            };
            match &field.kind {
                FieldKind::Expression | FieldKind::Condition => {
                    self.text(value, &path, None, false)
                }
                FieldKind::Text {
                    max,
                    template: true,
                    ..
                } => self.text(value, &path, Some(*max), true),
                FieldKind::List { item, .. } => {
                    let Value::Array(rows) = value else { continue };
                    for (number, row) in rows.iter_mut().enumerate() {
                        if let Value::Object(row) = row {
                            self.object(row, item, &format!("{path}[{number}]"));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn text(&mut self, value: &mut Value, path: &str, max: Option<usize>, template: bool) {
        let Value::String(source) = value else { return };
        let result = if template {
            rename_step_in_template(self.engine, source, self.from, self.to)
        } else {
            self.engine.rename_step(source, self.from, self.to)
        };
        let field = FieldRef {
            node: self.node.clone(),
            path: path.to_owned(),
        };
        match result {
            Ok(None) => {}
            Ok(Some(new)) => {
                if let Some(max) = max
                    && new.chars().count() > max
                {
                    self.left_alone.push(LeftAlone {
                        field,
                        reason: format!("the text would be longer than {max} characters"),
                    });
                    return;
                }
                *source = new;
                self.rewritten.push(field);
            }
            Err(error) => self.left_alone.push(LeftAlone {
                field,
                reason: error.to_string(),
            }),
        }
    }
}
