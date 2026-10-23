//! The graph rules of a flow: ids, aliases, ports, the trigger, reachability and cycles.
//!
//! Every pass is iterative: a flow can be as deep as its node count, and a run of compile must
//! not depend on the size of the stack.

use std::collections::{BTreeSet, HashMap, HashSet};

use graph::{Flow, FlowName, Node, PortName};

use super::diagnostic::{Code, Diagnostic, clip};
use crate::catalog::{LookupError, NodeSpec, Registry};

/// The most nodes compile accepts in one flow. Provisional **[measure]**.
pub const MAX_FLOW_NODES: usize = 2048;
/// The most lines compile accepts in one flow. Provisional **[measure]**.
pub const MAX_FLOW_LINES: usize = 8192;

/// A line whose two ends exist, as node positions.
#[derive(Debug, Clone, Copy)]
pub(super) struct Edge<'a> {
    pub from: usize,
    pub to: usize,
    pub port: &'a PortName,
}

/// A flow resolved against the catalog.
pub(super) struct FlowGraph<'a> {
    pub flow: &'a Flow,
    /// The schema of each node, `None` when its type or version is unknown.
    pub specs: Vec<Option<&'static NodeSpec>>,
    /// The position of the first node with each id.
    pub index: HashMap<&'a str, usize>,
    pub edges: Vec<Edge<'a>>,
    /// The edges that leave and enter each node, as positions in `edges`.
    pub out_edges: Vec<Vec<usize>>,
    pub in_edges: Vec<Vec<usize>>,
    /// The only trigger, when there is exactly one.
    pub trigger: Option<usize>,
    /// The flow is too large to analyze; the other passes skip it.
    pub too_big: bool,
    /// No rule of this module failed, so the flow is an acyclic graph in which every node is
    /// reachable from its only trigger, and `order` is filled.
    pub sound: bool,
    /// A topological order that starts at the trigger and breaks ties by node id, so it does
    /// not depend on the order of the nodes in the file.
    pub order: Vec<usize>,
}

impl<'a> FlowGraph<'a> {
    pub fn node(&self, position: usize) -> &'a Node {
        &self.flow.nodes[position]
    }
}

pub(super) fn analyze<'a>(
    name: &FlowName,
    flow: &'a Flow,
    registry: &Registry,
    out: &mut Vec<Diagnostic>,
) -> FlowGraph<'a> {
    let mut graph = FlowGraph {
        flow,
        specs: vec![None; flow.nodes.len()],
        index: HashMap::new(),
        edges: Vec::new(),
        out_edges: vec![Vec::new(); flow.nodes.len()],
        in_edges: vec![Vec::new(); flow.nodes.len()],
        trigger: None,
        too_big: false,
        sound: false,
        order: Vec::new(),
    };
    let mut report = Reporter {
        flow: name,
        out,
        errors: 0,
    };

    if flow.nodes.len() > MAX_FLOW_NODES {
        report.flow(
            Code::TooManyFlowNodes,
            format!(
                "the flow has {} nodes; the limit is {MAX_FLOW_NODES}",
                flow.nodes.len()
            ),
        );
        graph.too_big = true;
        return graph;
    }
    if flow.lines.len() > MAX_FLOW_LINES {
        report.flow(
            Code::TooManyFlowLines,
            format!(
                "the flow has {} lines; the limit is {MAX_FLOW_LINES}",
                flow.lines.len()
            ),
        );
        graph.too_big = true;
        return graph;
    }

    resolve_nodes(&mut graph, registry, &mut report);
    resolve_lines(&mut graph, &mut report);
    find_trigger(&mut graph, &mut report);
    if graph.trigger.is_some() {
        check_reachable(&graph, &mut report);
    }
    check_cycles(&graph, &mut report);

    if report.errors == 0 {
        graph.sound = true;
        graph.order = topological_order(&graph);
    }
    graph
}

/// Pushes diagnostics of one flow and counts the errors among them.
struct Reporter<'r> {
    flow: &'r FlowName,
    out: &'r mut Vec<Diagnostic>,
    errors: usize,
}

impl Reporter<'_> {
    fn push(&mut self, node: Option<&Node>, path: Option<String>, code: Code, message: String) {
        if code.severity() == super::diagnostic::Severity::Error {
            self.errors += 1;
        }
        self.out.push(Diagnostic {
            flow: Some(self.flow.clone()),
            node: node.map(|n| n.id.clone()),
            path,
            code,
            message,
        });
    }

    fn flow(&mut self, code: Code, message: String) {
        self.push(None, None, code, message);
    }

    fn node(&mut self, node: &Node, code: Code, message: String) {
        self.push(Some(node), None, code, message);
    }
}

fn resolve_nodes<'a>(graph: &mut FlowGraph<'a>, registry: &Registry, report: &mut Reporter<'_>) {
    let mut aliases: HashSet<&str> = HashSet::new();
    for (position, node) in graph.flow.nodes.iter().enumerate() {
        match registry.get(&node.kind, node.type_version) {
            Ok(spec) => graph.specs[position] = Some(spec),
            Err(LookupError::UnknownType) => report.node(
                node,
                Code::UnknownNodeType,
                format!("the node type `{}` does not exist", clip(&node.kind)),
            ),
            Err(LookupError::UnknownVersion) => report.node(
                node,
                Code::UnknownTypeVersion,
                format!(
                    "the node type `{}` has no version {}",
                    clip(&node.kind),
                    node.type_version
                ),
            ),
        }
        if graph.index.contains_key(node.id.as_str()) {
            report.node(
                node,
                Code::DuplicateNodeId,
                format!(
                    "another node of this flow has the id `{}`",
                    node.id.as_str()
                ),
            );
        } else {
            graph.index.insert(node.id.as_str(), position);
        }
        if !aliases.insert(node.alias.as_str()) {
            report.push(
                Some(node),
                Some("alias".to_owned()),
                Code::DuplicateAlias,
                format!(
                    "another node of this flow has the alias `{}`",
                    node.alias.as_str()
                ),
            );
        }
    }
}

fn resolve_lines<'a>(graph: &mut FlowGraph<'a>, report: &mut Reporter<'_>) {
    let mut seen: HashSet<(usize, &str, usize)> = HashSet::new();
    for (number, line) in graph.flow.lines.iter().enumerate() {
        let path = format!("lines[{number}]");
        let from = graph.index.get(line.from.node.as_str()).copied();
        let to = graph.index.get(line.to.as_str()).copied();
        let mut ok = true;
        if from.is_none() {
            ok = false;
            report.out.push(Diagnostic {
                flow: Some(report.flow.clone()),
                node: Some(line.from.node.clone()),
                path: Some(path.clone()),
                code: Code::LineFromUnknownNode,
                message: format!(
                    "no node of this flow has the id `{}`",
                    line.from.node.as_str()
                ),
            });
            report.errors += 1;
        }
        if to.is_none() {
            ok = false;
            report.out.push(Diagnostic {
                flow: Some(report.flow.clone()),
                node: Some(line.from.node.clone()),
                path: Some(path.clone()),
                code: Code::LineToUnknownNode,
                message: format!("no node of this flow has the id `{}`", line.to.as_str()),
            });
            report.errors += 1;
        }
        let (Some(from), Some(to), true) = (from, to, ok) else {
            continue;
        };
        let source = graph.node(from);
        if let Some(spec) = graph.specs[from]
            && !spec.has_port(line.from.port.as_str())
        {
            report.push(
                Some(source),
                Some(path.clone()),
                Code::UnknownPort,
                format!(
                    "the node type `{}` has no output port `{}`",
                    spec.type_id,
                    line.from.port.as_str()
                ),
            );
            continue;
        }
        if graph.specs[to].is_some_and(|spec| spec.trigger.is_some()) {
            report.push(
                Some(source),
                Some(path.clone()),
                Code::LineIntoTrigger,
                format!(
                    "`{}` is a trigger, which starts a flow and takes no line",
                    line.to.as_str()
                ),
            );
        }
        if !seen.insert((from, line.from.port.as_str(), to)) {
            report.push(
                Some(source),
                Some(path),
                Code::DuplicateLine,
                format!(
                    "port `{}` already leads to `{}`",
                    line.from.port.as_str(),
                    line.to.as_str()
                ),
            );
            continue;
        }
        let edge = graph.edges.len();
        graph.edges.push(Edge {
            from,
            to,
            port: &line.from.port,
        });
        graph.out_edges[from].push(edge);
        graph.in_edges[to].push(edge);
    }
}

fn find_trigger(graph: &mut FlowGraph<'_>, report: &mut Reporter<'_>) {
    let triggers: Vec<usize> = graph
        .specs
        .iter()
        .enumerate()
        .filter(|(_, spec)| spec.is_some_and(|spec| spec.trigger.is_some()))
        .map(|(position, _)| position)
        .collect();
    match triggers.as_slice() {
        [] => report.flow(Code::NoTrigger, "the flow has no trigger".to_owned()),
        [only] => graph.trigger = Some(*only),
        many => {
            for position in many {
                report.node(
                    graph.node(*position),
                    Code::MultipleTriggers,
                    format!("the flow has {} triggers; it needs exactly one", many.len()),
                );
            }
        }
    }
}

fn check_reachable(graph: &FlowGraph<'_>, report: &mut Reporter<'_>) {
    let Some(trigger) = graph.trigger else { return };
    let mut reached = vec![false; graph.flow.nodes.len()];
    reached[trigger] = true;
    let mut stack = vec![trigger];
    while let Some(node) = stack.pop() {
        for &edge in &graph.out_edges[node] {
            let next = graph.edges[edge].to;
            if !reached[next] {
                reached[next] = true;
                stack.push(next);
            }
        }
    }
    for (position, reached) in reached.iter().enumerate() {
        if !reached {
            report.node(
                graph.node(position),
                Code::UnreachableNode,
                "no line leads from the trigger to this node".to_owned(),
            );
        }
    }
}

fn check_cycles(graph: &FlowGraph<'_>, report: &mut Reporter<'_>) {
    let count = graph.flow.nodes.len();
    let mut in_degree: Vec<usize> = graph.in_edges.iter().map(Vec::len).collect();
    let mut ready: Vec<usize> = (0..count).filter(|&n| in_degree[n] == 0).collect();
    let mut removed = vec![false; count];
    while let Some(node) = ready.pop() {
        removed[node] = true;
        for &edge in &graph.out_edges[node] {
            let next = graph.edges[edge].to;
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                ready.push(next);
            }
        }
    }
    if removed.iter().all(|&r| r) {
        return;
    }
    // What is left is on a cycle or downstream of one. Peel off the nodes with no line out to
    // another leftover node; the rest lie on cycles.
    let mut out_degree = vec![0usize; count];
    for edge in &graph.edges {
        if !removed[edge.from] && !removed[edge.to] {
            out_degree[edge.from] += 1;
        }
    }
    let mut sinks: Vec<usize> = (0..count)
        .filter(|&n| !removed[n] && out_degree[n] == 0)
        .collect();
    while let Some(node) = sinks.pop() {
        removed[node] = true;
        for &edge in &graph.in_edges[node] {
            let before = graph.edges[edge].from;
            if !removed[before] {
                out_degree[before] -= 1;
                if out_degree[before] == 0 {
                    sinks.push(before);
                }
            }
        }
    }
    let on_cycle = (0..count)
        .filter(|&n| !removed[n])
        .min_by(|&a, &b| graph.node(a).id.cmp(&graph.node(b).id));
    if let Some(position) = on_cycle {
        report.node(
            graph.node(position),
            Code::Cycle,
            "the lines form a cycle through this node; a flow cannot loop".to_owned(),
        );
    }
}

/// Kahn's algorithm, taking the smallest node id among the ready nodes each time.
fn topological_order(graph: &FlowGraph<'_>) -> Vec<usize> {
    let count = graph.flow.nodes.len();
    let mut in_degree: Vec<usize> = graph.in_edges.iter().map(Vec::len).collect();
    let mut ready: BTreeSet<(&str, usize)> = (0..count)
        .filter(|&n| in_degree[n] == 0)
        .map(|n| (graph.node(n).id.as_str(), n))
        .collect();
    let mut order = Vec::with_capacity(count);
    while let Some((_, node)) = ready.pop_first() {
        order.push(node);
        for &edge in &graph.out_edges[node] {
            let next = graph.edges[edge].to;
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                ready.insert((graph.node(next).id.as_str(), next));
            }
        }
    }
    order
}
