//! Property tests of compile: no panic on any project, and the guarantees of a valid one.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use common::*;
use graph::{Flow, Line, Node, Project};
use proptest::prelude::*;
use runtime::compile::Code;
use serde_json::{Value, json};

// ---- Arbitrary projects: compile never panics -------------------------------------------------

fn text() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("Pong!".to_owned()),
        Just("{{ event.user.id }}".to_owned()),
        Just("{{ steps.a1.message_id }}".to_owned()),
        Just("{{ vars.bot.x }} {{ error.kind }}".to_owned()),
        Just("{{ 1 +".to_owned()),
        Just(String::new()),
        "\\PC{0,40}",
    ]
}

fn leaf() -> impl Strategy<Value = Value> {
    prop_oneof![
        text().prop_map(Value::String),
        any::<i64>().prop_map(|n| json!(n)),
        any::<bool>().prop_map(Value::Bool),
        Just(Value::Null),
        Just(json!([{ "name": "x", "description": "d", "type": "string" }])),
        Just(json!([1, "two", null, {}])),
        Just(json!({ "nested": { "deep": [] } })),
    ]
}

fn settings() -> impl Strategy<Value = Value> {
    let key = prop_oneof![
        Just("name"),
        Just("description"),
        Just("content"),
        Just("condition"),
        Just("options"),
        Just("ephemeral"),
        Just("other"),
    ];
    prop::collection::btree_map(key.prop_map(str::to_owned), leaf(), 0..5)
        .prop_map(|map| Value::Object(map.into_iter().collect()))
}

fn arbitrary_node() -> impl Strategy<Value = Node> {
    let kind = prop_oneof![
        Just("discord.slash_command"),
        Just("discord.reply"),
        Just("logic.branch"),
        Just("x.unknown"),
    ];
    (0..6usize, 0..6usize, kind, 1..3u32, settings()).prop_map(|(id, alias, kind, version, s)| {
        let mut node = node(&format!("n{id}"), &format!("a{alias}"), kind, s);
        node.type_version = version;
        node
    })
}

fn arbitrary_line() -> impl Strategy<Value = Line> {
    let port = prop_oneof![
        Just("next"),
        Just("true"),
        Just("false"),
        Just("error"),
        Just("bogus")
    ];
    (0..7usize, port, 0..7usize)
        .prop_map(|(from, port, to)| line(&format!("n{from}"), port, &format!("n{to}")))
}

fn arbitrary_project() -> impl Strategy<Value = Project> {
    let flow = (
        prop::collection::vec(arbitrary_node(), 0..8),
        prop::collection::vec(arbitrary_line(), 0..10),
    )
        .prop_map(|(nodes, lines)| Flow { nodes, lines });
    prop::collection::vec(flow, 1..3).prop_map(|flows| {
        let named = flows
            .into_iter()
            .enumerate()
            .map(|(i, f)| (format!("f{i}"), f))
            .collect::<Vec<_>>();
        project(named.iter().map(|(n, f)| (n.as_str(), f.clone())).collect())
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn compile_never_panics_and_a_payload_is_always_consistent(project in arbitrary_project()) {
        let report = run(&project);
        let mut sorted = report.diagnostics.clone();
        sorted.sort();
        prop_assert_eq!(&report.diagnostics, &sorted);
        match &report.payload {
            Some(payload) => {
                prop_assert!(!report.has_errors());
                prop_assert!(payload.check().is_ok());
                prop_assert!(payload.encode().is_ok());
            }
            None => prop_assert!(report.has_errors()),
        }
    }
}

// ---- Valid projects: a random acyclic graph with valid ports ----------------------------------

/// The shape of a valid flow: node 0 is the trigger; node `i` is a reply or a branch and has
/// one to three lines from earlier nodes.
#[derive(Debug, Clone)]
struct Dag {
    branches: Vec<bool>,
    parents: Vec<Vec<(usize, usize)>>,
}

fn dag() -> impl Strategy<Value = Dag> {
    (1..9usize).prop_flat_map(|extra| {
        (
            prop::collection::vec(any::<bool>(), extra),
            prop::collection::vec(
                prop::collection::vec((any::<usize>(), any::<usize>()), 1..4),
                extra,
            ),
        )
            .prop_map(|(branches, parents)| Dag { branches, parents })
    })
}

fn ports(is_trigger: bool, is_branch: bool) -> &'static [&'static str] {
    match (is_trigger, is_branch) {
        (true, _) => &["next"],
        (false, true) => &["true", "false", "error"],
        (false, false) => &["next", "error"],
    }
}

impl Dag {
    fn is_branch(&self, node: usize) -> bool {
        node > 0 && self.branches[node - 1]
    }

    fn nodes(&self) -> Vec<Node> {
        let mut nodes = vec![slash("n0", "a0", "ping")];
        for (i, branch_node) in self.branches.iter().enumerate() {
            let i = i + 1;
            let (id, alias) = (format!("n{i}"), format!("a{i}"));
            nodes.push(if *branch_node {
                branch(&id, &alias, "event.user.id == 'x'")
            } else {
                reply(&id, &alias, "{{ event.user.id }}")
            });
        }
        nodes
    }

    /// `(from, port, to)` without repeats.
    fn edges(&self) -> Vec<(usize, &'static str, usize)> {
        let mut edges = Vec::new();
        for (i, parents) in self.parents.iter().enumerate() {
            let to = i + 1;
            for (parent, port) in parents {
                let from = parent % to;
                let options = ports(from == 0, self.is_branch(from));
                let edge = (from, options[port % options.len()], to);
                if !edges.contains(&edge) {
                    edges.push(edge);
                }
            }
        }
        edges
    }

    fn lines(&self) -> Vec<Line> {
        self.edges()
            .into_iter()
            .map(|(from, port, to)| line(&format!("n{from}"), port, &format!("n{to}")))
            .collect()
    }
}

/// A permutation of `0..len` from random keys.
fn permute<T: Clone>(items: &[T], keys: &[u32]) -> Vec<T> {
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by_key(|&i| (keys[i % keys.len()], i));
    order.into_iter().map(|i| items[i].clone()).collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn a_valid_random_flow_compiles_with_its_indexes_in_range(dag in dag()) {
        let project = single(dag.nodes(), dag.lines());
        let report = run(&project);
        prop_assert!(!report.has_errors(), "{:#?}", report.diagnostics);
        let payload = report.payload.unwrap();
        prop_assert!(payload.check().is_ok());
        let nodes = &payload.flows[0].nodes;
        prop_assert_eq!(nodes.len(), dag.branches.len() + 1);
        prop_assert_eq!(nodes[0].id.as_str(), "n0");
        for (at, node) in nodes.iter().enumerate() {
            for output in &node.next {
                for target in &output.to {
                    // The order is topological: lines only go forward.
                    prop_assert!((*target as usize) > at);
                }
            }
        }
    }

    #[test]
    fn a_line_back_to_an_ancestor_is_always_a_cycle(dag in dag(), pick in any::<usize>(), port in any::<usize>()) {
        let j = 1 + pick % dag.branches.len();
        let (parent, _) = dag.parents[j - 1][0];
        let target = parent % j;
        let options = ports(false, dag.is_branch(j));
        let mut lines = dag.lines();
        lines.push(line(&format!("n{j}"), options[port % options.len()], &format!("n{target}")));
        let report = run(&single(dag.nodes(), lines));
        prop_assert!(has(&report, Code::Cycle), "{:#?}", report.diagnostics);
        prop_assert!(report.payload.is_none());
    }

    #[test]
    fn the_order_of_nodes_and_lines_does_not_change_the_result(
        dag in dag(),
        node_keys in prop::collection::vec(any::<u32>(), 1..12),
        line_keys in prop::collection::vec(any::<u32>(), 1..40),
    ) {
        let straight = run(&single(dag.nodes(), dag.lines()));
        let shuffled = run(&single(
            permute(&dag.nodes(), &node_keys),
            permute(&dag.lines(), &line_keys),
        ));
        prop_assert_eq!(&straight.diagnostics, &shuffled.diagnostics);
        prop_assert_eq!(
            straight.payload.unwrap().encode().unwrap(),
            shuffled.payload.unwrap().encode().unwrap()
        );
    }

    #[test]
    fn the_order_of_nodes_does_not_change_the_diagnostics_of_a_broken_flow(
        dag in dag(),
        node_keys in prop::collection::vec(any::<u32>(), 1..12),
    ) {
        // The last node loops on itself.
        let last = dag.branches.len();
        let mut lines = dag.lines();
        lines.push(line(&format!("n{last}"), if dag.is_branch(last) { "true" } else { "next" }, &format!("n{last}")));
        let straight = run(&single(dag.nodes(), lines.clone()));
        let shuffled = run(&single(permute(&dag.nodes(), &node_keys), lines));
        prop_assert!(has(&straight, Code::Cycle));
        prop_assert_eq!(&straight.diagnostics, &shuffled.diagnostics);
    }
}
