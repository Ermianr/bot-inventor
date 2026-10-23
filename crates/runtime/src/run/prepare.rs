//! From a payload to the flows a run walks: schemas looked up, expressions compiled once.

use graph::{Payload, PayloadNode};
use serde_json::{Map, Value};

use crate::catalog::{FieldKind, Registry};
use crate::expr::{ExprError, Expression, ExpressionEngine, References, Template};
use crate::nodes::Kind;

use super::{Declarations, Declared, RuntimeError};

/// An expression or a template, compiled.
pub(crate) enum Compiled {
    Template(Template),
    Expression(Box<dyn Expression>),
}

pub(crate) struct Flow {
    pub(crate) name: String,
    pub(crate) trigger: usize,
    pub(crate) nodes: Vec<PreparedNode>,
}

pub(crate) struct PreparedNode {
    pub(crate) id: String,
    pub(crate) alias: String,
    pub(crate) kind: Kind,
    pub(crate) settings: Map<String, Value>,
    /// The persistent variables its expressions read, fetched in one batch before it runs.
    pub(crate) reads: Vec<Declared>,
    compiled: Vec<(String, Compiled)>,
    next: Vec<(String, Vec<usize>)>,
}

impl PreparedNode {
    pub(crate) fn compiled(&self, field: &str) -> Option<&Compiled> {
        self.compiled
            .iter()
            .find(|(path, _)| path == field)
            .map(|(_, compiled)| compiled)
    }

    /// The nodes the line out of `port` leads to, in the order of the flow.
    pub(crate) fn targets(&self, port: &str) -> &[usize] {
        self.next
            .iter()
            .find(|(name, _)| name == port)
            .map_or(&[], |(_, to)| to)
    }
}

pub(super) fn flows(
    payload: &Payload,
    registry: &Registry,
    engine: &dyn ExpressionEngine,
    decls: &Declarations,
) -> Result<Vec<Flow>, RuntimeError> {
    payload
        .flows
        .iter()
        .map(|flow| {
            let name = flow.name.as_str();
            let nodes = flow
                .nodes
                .iter()
                .map(|node| prepare(name, node, registry, engine, decls))
                .collect::<Result<Vec<_>, _>>()?;
            let trigger = usize::try_from(flow.trigger)
                .ok()
                .filter(|&trigger| {
                    nodes
                        .get(trigger)
                        .is_some_and(|node| node.kind.spec().trigger.is_some())
                })
                .ok_or_else(|| RuntimeError::NotATrigger {
                    flow: name.to_owned(),
                })?;
            Ok(Flow {
                name: name.to_owned(),
                trigger,
                nodes,
            })
        })
        .collect()
}

fn prepare(
    flow: &str,
    node: &PayloadNode,
    registry: &Registry,
    engine: &dyn ExpressionEngine,
    decls: &Declarations,
) -> Result<PreparedNode, RuntimeError> {
    let unknown = || RuntimeError::UnknownNode {
        flow: flow.to_owned(),
        node: node.id.as_str().to_owned(),
    };
    let spec = registry
        .get(&node.kind, node.type_version)
        .map_err(|_| unknown())?;
    let kind = Kind::of(spec.type_id).ok_or_else(unknown)?;

    let mut compiled = Vec::with_capacity(node.expressions.len());
    for expression in &node.expressions {
        let bad = |reason: String| RuntimeError::BadExpression {
            flow: flow.to_owned(),
            node: node.id.as_str().to_owned(),
            path: expression.path.clone(),
            reason,
        };
        let field = spec
            .fields
            .iter()
            .find(|field| field.name == expression.path)
            .ok_or_else(|| bad("the node has no such setting".to_owned()))?;
        let value = match field.kind {
            FieldKind::Text { template: true, .. } => {
                Template::compile(engine, &expression.source).map(Compiled::Template)
            }
            FieldKind::Expression => engine.compile(&expression.source).map(Compiled::Expression),
            _ => Err(ExprError::Unsupported("this setting holds no expression")),
        }
        .map_err(|error| bad(error.to_string()))?;
        compiled.push((expression.path.clone(), value));
    }

    let mut references = References::default();
    for (_, compiled) in &compiled {
        references.extend(match compiled {
            Compiled::Template(template) => template.references(),
            Compiled::Expression(expression) => expression.references(),
        });
    }
    let reads = decls.reads(&references);

    let next = node
        .next
        .iter()
        .map(|output| {
            let to = output
                .to
                .iter()
                .map(|&target| usize::try_from(target).map_err(|_| unknown()))
                .collect::<Result<Vec<_>, _>>()?;
            Ok((output.port.as_str().to_owned(), to))
        })
        .collect::<Result<Vec<_>, RuntimeError>>()?;

    Ok(PreparedNode {
        id: node.id.as_str().to_owned(),
        alias: node.alias.as_str().to_owned(),
        kind,
        settings: node.settings.clone(),
        reads,
        compiled,
        next,
    })
}
