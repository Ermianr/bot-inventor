//! Compile: checks a project and turns it into a payload (`docs/ARCHITECTURE.md` §3.3).
//!
//! The same function serves the editor, which shows the diagnostics, and the export, which needs
//! a payload. A project with an error has no payload. Every diagnostic says where it is: the
//! flow, the node and the path of the field.

mod diagnostic;
mod discord;
mod expressions;
mod paths;
mod settings;
mod structure;
mod variables;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub use diagnostic::{Code, Diagnostic, Severity};
pub use discord::{
    MAX_COMMAND_CHARS, MAX_COMMANDS, MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS, MAX_OPTIONS,
};
use graph::{
    CommandDef, EventRoute, FlowName, NodeId, Output, Payload, PayloadFlow, PayloadNode, Project,
    Requirements, Variable, VariableType,
};
pub use structure::{MAX_FLOW_LINES, MAX_FLOW_NODES};

use crate::catalog::Registry;
use crate::expr::{CelEngine, ExpressionEngine};
use expressions::FlowScope;
use structure::FlowGraph;

/// The result of compiling a project.
#[derive(Debug)]
pub struct Report {
    /// Errors and warnings, in a fixed order: by flow, node, field and code.
    pub diagnostics: Vec<Diagnostic>,
    /// The compiled bot; `None` when there is any error.
    pub payload: Option<Payload>,
    /// The variables each node's expressions read, so the runtime can fetch them in one batch.
    pub variable_reads: Vec<NodeReads>,
}

impl Report {
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(Diagnostic::is_error)
    }
}

/// The variables one node reads, as `scope.name`, sorted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeReads {
    pub flow: FlowName,
    pub node: NodeId,
    pub variables: Vec<String>,
}

/// Compiles `project` with the nodes the app ships.
#[must_use]
pub fn compile(project: &Project, app_version: &str) -> Report {
    compile_with(
        &Registry::builtin(),
        &CelEngine::new(),
        project,
        app_version,
    )
}

/// Compiles `project` with the given catalog and expression engine.
#[must_use]
pub fn compile_with(
    registry: &Registry,
    engine: &dyn ExpressionEngine,
    project: &Project,
    app_version: &str,
) -> Report {
    let mut diagnostics = Vec::new();
    let declared = check_variables(&project.manifest.variables, &mut diagnostics);
    let kinds = declared_kinds(&project.manifest.variables);

    let mut analyzed = Vec::new();
    let mut commands: Vec<(usize, &FlowName, &graph::Node, discord::Command)> = Vec::new();
    let mut intents = BTreeSet::new();
    let mut cache = BTreeSet::new();
    let mut assets = BTreeSet::new();
    let mut variable_reads = Vec::new();

    for (flow_index, (name, flow)) in project.flows.iter().enumerate() {
        let graph = structure::analyze(name, flow, registry, &mut diagnostics);
        if graph.too_big {
            continue;
        }
        let scope = FlowScope::new(name, &graph, &declared);
        let mut expressions = vec![Vec::new(); flow.nodes.len()];
        for (position, node) in flow.nodes.iter().enumerate() {
            let Some(spec) = graph.specs[position] else {
                continue;
            };
            intents.extend(spec.requires.intents.iter().copied());
            cache.extend(spec.requires.cache.iter().copied());
            let checked = settings::check(name, node, spec, &mut diagnostics);
            assets.extend(checked.assets.iter().cloned());
            if checked.ok && spec.type_id == crate::nodes::SET_VARIABLE {
                variables::check_set(name, node, &kinds, &mut diagnostics);
            }
            let mut reads = BTreeSet::new();
            expressions[position] = expressions::check_node(
                &scope,
                position,
                &checked.expressions,
                engine,
                &mut reads,
                &mut diagnostics,
            );
            if !reads.is_empty() {
                variable_reads.push(NodeReads {
                    flow: name.clone(),
                    node: node.id.clone(),
                    variables: reads.into_iter().collect(),
                });
            }
            if checked.ok
                && spec.trigger.as_ref().is_some_and(|trigger| trigger.command)
                && let Some(command) = discord::check_command(name, node, &mut diagnostics)
            {
                commands.push((flow_index, name, node, command));
            }
        }
        analyzed.push((flow_index, name, graph, expressions));
    }

    check_commands(&commands, &mut diagnostics);

    diagnostics.sort();
    variable_reads.sort_by(|a, b| (&a.flow, &a.node).cmp(&(&b.flow, &b.node)));
    let mut report = Report {
        diagnostics,
        payload: None,
        variable_reads,
    };
    if report.has_errors() {
        return report;
    }

    let mut payload = Payload::new(app_version);
    let mut routes: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for (flow_index, name, graph, expressions) in &analyzed {
        let Ok(index) = u32::try_from(*flow_index) else {
            continue;
        };
        payload.flows.push(emit_flow(name, graph, expressions));
        if let Some(event) = graph
            .trigger
            .and_then(|trigger| graph.specs[trigger])
            .and_then(|spec| spec.trigger.as_ref())
            .map(|trigger| trigger.event)
        {
            routes.entry(event).or_default().push(index);
        }
    }
    payload.events = routes
        .into_iter()
        .map(|(event, flows)| EventRoute {
            event: event.to_owned(),
            flows,
        })
        .collect();
    for (flow_index, _, _, command) in commands {
        if let Ok(flow) = u32::try_from(flow_index) {
            payload.commands.push(CommandDef {
                name: command.name,
                flow,
                hash: command.hash,
                definition: command.definition,
            });
        }
    }
    payload.commands.sort_by(|a, b| a.name.cmp(&b.name));
    payload.variables.clone_from(&project.manifest.variables);
    payload.requirements = Requirements {
        intents: intents.into_iter().map(str::to_owned).collect(),
        cache: cache.into_iter().map(str::to_owned).collect(),
        assets: assets.into_iter().collect(),
    };

    match payload.check() {
        Ok(()) => report.payload = Some(payload),
        Err(error) => report.diagnostics.push(Diagnostic {
            flow: None,
            node: None,
            path: None,
            code: Code::InvalidPayload,
            message: error.to_string(),
        }),
    }
    report
}

/// Checks the declarations and returns the declared names as `scope.name`.
fn check_variables(variables: &[Variable], out: &mut Vec<Diagnostic>) -> HashSet<String> {
    let mut declared = HashSet::new();
    for (number, variable) in variables.iter().enumerate() {
        let scope = serde_json::to_value(variable.scope)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        let key = format!("{scope}.{}", variable.name.as_str());
        let mut push = |path: String, code: Code, message: String| {
            out.push(Diagnostic {
                flow: None,
                node: None,
                path: Some(path),
                code,
                message,
            });
        };
        if !declared.insert(key.clone()) {
            push(
                format!("variables[{number}]"),
                Code::DuplicateVariable,
                format!("`{key}` is declared more than once"),
            );
        }
        let matches = match variable.kind {
            VariableType::Integer => variable.initial.is_i64(),
            VariableType::Decimal => variable.initial.is_number(),
            VariableType::Text => variable.initial.is_string(),
            VariableType::Boolean => variable.initial.is_boolean(),
        };
        if !matches {
            let expected = match variable.kind {
                VariableType::Integer => "a whole number",
                VariableType::Decimal => "a number",
                VariableType::Text => "text",
                VariableType::Boolean => "a boolean",
            };
            push(
                format!("variables[{number}].initial"),
                Code::InitialTypeMismatch,
                format!("the initial value of `{key}` must be {expected}"),
            );
        }
    }
    declared
}

/// The type of each declared variable by `scope.name`; the first declaration wins.
fn declared_kinds(variables: &[Variable]) -> HashMap<String, VariableType> {
    let mut kinds = HashMap::new();
    for variable in variables {
        let scope = serde_json::to_value(variable.scope)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        kinds
            .entry(format!("{scope}.{}", variable.name.as_str()))
            .or_insert(variable.kind);
    }
    kinds
}

/// Rules that look at all the commands of the project together.
fn check_commands(
    commands: &[(usize, &FlowName, &graph::Node, discord::Command)],
    out: &mut Vec<Diagnostic>,
) {
    let mut names: HashSet<&str> = HashSet::new();
    for (_, flow, node, command) in commands {
        if !names.insert(&command.name) {
            out.push(Diagnostic {
                flow: Some((*flow).clone()),
                node: Some(node.id.clone()),
                path: Some("name".to_owned()),
                code: Code::DuplicateCommand,
                message: "another flow defines a command with this name".to_owned(),
            });
        }
    }
    if names.len() > MAX_COMMANDS {
        out.push(Diagnostic {
            flow: None,
            node: None,
            path: None,
            code: Code::TooManyCommands,
            message: format!(
                "the project defines {} commands; Discord allows {MAX_COMMANDS}",
                names.len()
            ),
        });
    }
}

/// One flow of the payload: nodes in the canonical order of the graph, lines as indexes.
fn emit_flow(
    name: &FlowName,
    graph: &FlowGraph<'_>,
    expressions: &[Vec<graph::Expression>],
) -> PayloadFlow {
    let mut position_of = vec![0u32; graph.order.len()];
    for (at, &node) in graph.order.iter().enumerate() {
        position_of[node] = u32::try_from(at).unwrap_or(u32::MAX);
    }
    let nodes = graph
        .order
        .iter()
        .map(|&position| {
            let node = graph.node(position);
            let mut by_port: BTreeMap<&str, (&graph::PortName, Vec<u32>)> = BTreeMap::new();
            for &edge in &graph.out_edges[position] {
                let edge = graph.edges[edge];
                by_port
                    .entry(edge.port.as_str())
                    .or_insert_with(|| (edge.port, Vec::new()))
                    .1
                    .push(position_of[edge.to]);
            }
            PayloadNode {
                id: node.id.clone(),
                alias: node.alias.clone(),
                kind: node.kind.clone(),
                type_version: node.type_version,
                settings: node.settings.clone(),
                expressions: expressions[position].clone(),
                next: by_port
                    .into_values()
                    .map(|(port, mut to)| {
                        to.sort_unstable();
                        Output {
                            port: port.clone(),
                            to,
                        }
                    })
                    .collect(),
            }
        })
        .collect();
    PayloadFlow {
        name: name.clone(),
        trigger: 0,
        nodes,
    }
}
