//! Compiles the expressions and templates of a flow and resolves what they read.

use std::collections::{BTreeSet, HashMap, HashSet};

use graph::{Expression as PayloadExpression, FlowName, Node};

use super::diagnostic::{Code, Diagnostic, clip};
use super::paths::{Paths, Presence};
use super::settings::ExpressionField;
use super::structure::FlowGraph;
use crate::catalog::TriggerSpec;
use crate::expr::{ExpressionEngine, Path, Template};

/// What a flow's expressions are resolved against.
pub(super) struct FlowScope<'a> {
    pub flow: &'a FlowName,
    pub graph: &'a FlowGraph<'a>,
    /// `None` when the flow is not sound, so the order of the nodes is not known.
    pub paths: Option<Paths>,
    aliases: HashMap<&'a str, usize>,
    event: Option<EventShape>,
    /// `scope.name` of every declared variable.
    variables: &'a HashSet<String>,
}

/// The fields of the event that starts the flow.
struct EventShape {
    name: &'static str,
    /// A path of the event, and whether names may continue below it.
    leaves: Vec<(Vec<String>, bool)>,
    containers: Vec<&'static str>,
}

impl<'a> FlowScope<'a> {
    pub fn new(
        flow: &'a FlowName,
        graph: &'a FlowGraph<'a>,
        variables: &'a HashSet<String>,
    ) -> Self {
        let mut aliases = HashMap::new();
        for (position, node) in graph.flow.nodes.iter().enumerate() {
            aliases.entry(node.alias.as_str()).or_insert(position);
        }
        let event = graph.trigger.and_then(|position| {
            let spec = graph.specs[position]?.trigger.as_ref()?;
            Some(event_shape(spec, graph.node(position)))
        });
        Self {
            flow,
            graph,
            paths: Paths::new(graph),
            aliases,
            event,
            variables,
        }
    }
}

fn event_shape(spec: &TriggerSpec, trigger: &Node) -> EventShape {
    let leaves = spec
        .event_names(&trigger.settings)
        .into_iter()
        .map(|name| (name.segments, name.open))
        .collect();
    let containers = if spec.options_field.is_some() {
        vec!["options"]
    } else {
        Vec::new()
    };
    EventShape {
        name: spec.event,
        leaves,
        containers,
    }
}

/// Compiles every expression field of the node at `position`, reports what is wrong with them
/// and what they read, and returns the ones the payload keeps.
pub(super) fn check_node(
    scope: &FlowScope<'_>,
    position: usize,
    fields: &[ExpressionField],
    engine: &dyn ExpressionEngine,
    reads: &mut BTreeSet<String>,
    out: &mut Vec<Diagnostic>,
) -> Vec<PayloadExpression> {
    let node = scope.graph.node(position);
    let mut kept = Vec::new();
    for field in fields {
        let mut at = At {
            scope,
            position,
            node,
            path: &field.path,
            out,
        };
        let (keep, references) = if field.template {
            match Template::compile(engine, &field.source) {
                Ok(template) => (template.has_segments(), template.references().clone()),
                Err(error) => {
                    at.push(Code::InvalidExpression, error.to_string());
                    continue;
                }
            }
        } else {
            match engine.compile(&field.source) {
                Ok(expression) => (true, expression.references().clone()),
                Err(error) => {
                    at.push(Code::InvalidExpression, error.to_string());
                    continue;
                }
            }
        };
        for path in references.paths() {
            at.resolve(path, reads);
        }
        if keep {
            kept.push(PayloadExpression {
                path: field.path.clone(),
                source: field.source.clone(),
            });
        }
    }
    kept
}

struct At<'a, 'b> {
    scope: &'a FlowScope<'a>,
    position: usize,
    node: &'a Node,
    path: &'a str,
    out: &'b mut Vec<Diagnostic>,
}

impl At<'_, '_> {
    fn push(&mut self, code: Code, message: String) {
        self.out.push(Diagnostic {
            flow: Some(self.scope.flow.clone()),
            node: Some(self.node.id.clone()),
            path: Some(self.path.to_owned()),
            code,
            message,
        });
    }

    fn resolve(&mut self, path: &Path, reads: &mut BTreeSet<String>) {
        let segments = path.segments();
        match path.root() {
            "event" => self.event(path),
            "steps" => self.step(path),
            "vars" => match segments {
                [_, scope, name, ..] => {
                    let key = format!("{scope}.{name}");
                    if self.scope.variables.contains(&key) {
                        reads.insert(key);
                    } else {
                        self.push(
                            Code::UnknownVariable,
                            format!("`{}` is not a declared variable", clip(&key)),
                        );
                    }
                }
                _ => self.push(
                    Code::IncompleteReference,
                    "a variable is read as `vars.<scope>.<name>`".to_owned(),
                ),
            },
            "error" => self.error(path),
            _ => {}
        }
    }

    fn event(&mut self, path: &Path) {
        let Some(event) = &self.scope.event else {
            return;
        };
        let rest = &path.segments()[1..];
        let known = rest.is_empty()
            || event.containers.iter().any(|c| rest == [*c])
            || event
                .leaves
                .iter()
                .any(|(leaf, open)| leaf.starts_with(rest) || (*open && rest.starts_with(leaf)));
        if !known {
            self.push(
                Code::UnknownEventField,
                format!(
                    "`{}` is not a field of the `{}` event",
                    clip(&path.to_string()),
                    event.name
                ),
            );
        }
    }

    fn step(&mut self, path: &Path) {
        let [_, alias, output, ..] = path.segments() else {
            return self.push(
                Code::IncompleteReference,
                "a step is read as `steps.<alias>.<output>`".to_owned(),
            );
        };
        let Some(&step) = self.scope.aliases.get(alias.as_str()) else {
            return self.push(
                Code::UnknownStep,
                format!("no node of this flow has the alias `{}`", clip(alias)),
            );
        };
        if let Some(spec) = self.scope.graph.specs[step]
            && !spec.has_output(output)
        {
            return self.push(
                Code::UnknownOutput,
                format!(
                    "the node `{}` of type `{}` has no output `{}`",
                    clip(alias),
                    spec.type_id,
                    clip(output)
                ),
            );
        }
        let Some(paths) = &self.scope.paths else {
            return;
        };
        match paths.step_before(step, self.position) {
            Presence::Always => {}
            Presence::Sometimes => self.push(
                Code::StepSometimes,
                format!(
                    "`{}` runs before this node on only some of the paths that reach it",
                    clip(alias)
                ),
            ),
            Presence::Never => self.push(
                Code::StepNotBefore,
                format!("`{}` never runs before this node", clip(alias)),
            ),
        }
    }

    fn error(&mut self, path: &Path) {
        if let Some(field) = path.segments().get(1)
            && field != "kind"
            && field != "message"
        {
            return self.push(
                Code::UnknownErrorField,
                format!(
                    "`error.{}` does not exist; use `error.kind` or `error.message`",
                    clip(field)
                ),
            );
        }
        let Some(paths) = &self.scope.paths else {
            return;
        };
        match paths.error_available(self.position) {
            Presence::Always => {}
            Presence::Sometimes => self.push(
                Code::ErrorSometimes,
                "this node is reached from an `error` port on only some of its paths".to_owned(),
            ),
            Presence::Never => self.push(
                Code::ErrorOutsideErrorPath,
                "`error` exists only in a node reached from an `error` port".to_owned(),
            ),
        }
    }
}
