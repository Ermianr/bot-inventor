//! Which nodes run before which, on a sound flow: the facts that decide whether a reference to
//! `steps.<alias>` or `error.*` is always, sometimes or never valid.

use super::structure::FlowGraph;
use crate::catalog::ERROR_PORT;

pub(super) struct Paths {
    words: usize,
    /// `ancestors[v]` is a bitset of the nodes with a path to `v`.
    ancestors: Vec<u64>,
    /// The interval of each node in the dominator tree.
    enter: Vec<usize>,
    leave: Vec<usize>,
    /// A path from the trigger reaches the node without any `error` port, or through one.
    normal: Vec<bool>,
    via_error: Vec<bool>,
}

/// How a name that exists only on some paths relates to a node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Presence {
    Always,
    Sometimes,
    Never,
}

impl Paths {
    /// `None` unless the flow is sound.
    pub fn new(graph: &FlowGraph<'_>) -> Option<Self> {
        if !graph.sound {
            return None;
        }
        let count = graph.flow.nodes.len();
        let trigger = graph.trigger?;
        let words = count.div_ceil(64).max(1);

        let mut position = vec![0usize; count];
        for (at, &node) in graph.order.iter().enumerate() {
            position[node] = at;
        }

        let mut ancestors = vec![0u64; count * words];
        for &node in &graph.order {
            for &edge in &graph.in_edges[node] {
                let before = graph.edges[edge].from;
                for word in 0..words {
                    ancestors[node * words + word] |= ancestors[before * words + word];
                }
                ancestors[node * words + before / 64] |= 1 << (before % 64);
            }
        }

        // Immediate dominators on an acyclic graph, in topological order.
        let mut idom = vec![trigger; count];
        for &node in graph.order.iter().skip(1) {
            let mut current: Option<usize> = None;
            for &edge in &graph.in_edges[node] {
                let before = graph.edges[edge].from;
                current = Some(match current {
                    None => before,
                    Some(other) => intersect(&idom, &position, before, other),
                });
            }
            idom[node] = current.unwrap_or(trigger);
        }
        let mut children = vec![Vec::new(); count];
        for &node in graph.order.iter().skip(1) {
            children[idom[node]].push(node);
        }
        let mut enter = vec![0usize; count];
        let mut leave = vec![0usize; count];
        let mut clock = 0usize;
        let mut stack = vec![(trigger, 0usize)];
        enter[trigger] = 0;
        clock += 1;
        while let Some((node, next_child)) = stack.pop() {
            if let Some(&child) = children[node].get(next_child) {
                stack.push((node, next_child + 1));
                enter[child] = clock;
                clock += 1;
                stack.push((child, 0));
            } else {
                leave[node] = clock;
                clock += 1;
            }
        }

        let mut normal = vec![false; count];
        let mut via_error = vec![false; count];
        normal[trigger] = true;
        for &node in &graph.order {
            for &edge in &graph.in_edges[node] {
                let edge = graph.edges[edge];
                let (n, e) = (normal[edge.from], via_error[edge.from]);
                if edge.port.as_str() == ERROR_PORT {
                    via_error[node] |= n || e;
                } else {
                    normal[node] |= n;
                    via_error[node] |= e;
                }
            }
        }

        Some(Self {
            words,
            ancestors,
            enter,
            leave,
            normal,
            via_error,
        })
    }

    /// Whether `step` runs before `node` on every path, on some, or on none.
    pub fn step_before(&self, step: usize, node: usize) -> Presence {
        let bit = self.ancestors[node * self.words + step / 64] >> (step % 64) & 1;
        if bit == 0 {
            Presence::Never
        } else if self.enter[step] <= self.enter[node] && self.leave[node] <= self.leave[step] {
            Presence::Always
        } else {
            Presence::Sometimes
        }
    }

    /// Whether `node` is reached through an `error` port on every path, on some, or on none.
    pub fn error_available(&self, node: usize) -> Presence {
        match (self.via_error[node], self.normal[node]) {
            (true, false) => Presence::Always,
            (true, true) => Presence::Sometimes,
            (false, _) => Presence::Never,
        }
    }
}

fn intersect(idom: &[usize], position: &[usize], mut a: usize, mut b: usize) -> usize {
    while a != b {
        while position[a] > position[b] {
            a = idom[a];
        }
        while position[b] > position[a] {
            b = idom[b];
        }
    }
    a
}
