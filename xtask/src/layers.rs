//! `cargo xtask layers`: the crate dependency rules of `docs/ARCHITECTURE.md` §2.
//!
//! Each crate of the workspace is registered with the crates of this repository it may use and
//! the external crates it must never link, directly or not. A crate that is not registered fails
//! the check, so a new crate is registered with its layer when it is created.

use std::collections::{HashMap, HashSet, VecDeque};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::run_capture;

/// The webview stack: only `apps/desktop` knows the GUI.
const GUI: &[&str] = &["tauri", "wry", "tao"];
/// Discord, only for `platform-discord` and the `runner` that wires it.
const DISCORD: &[&str] = &["twilight-*"];
/// SQLite, only for `storage-sqlite` and the `runner` that wires it.
const SQLITE: &[&str] = &["rusqlite"];

struct Layer {
    name: &'static str,
    /// The crates of this repository that this one may depend on.
    may_use: &'static [&'static str],
    /// The crates it may use only in tests (a dev-dependency), for an end-to-end test that
    /// needs two layers together.
    dev_may_use: &'static [&'static str],
    /// External crates (a trailing `*` matches a prefix) that must not be linked at all.
    never_links: &'static [&'static [&'static str]],
}

const LAYERS: &[Layer] = &[
    Layer {
        name: "graph",
        may_use: &[],
        dev_may_use: &[],
        never_links: &[GUI, DISCORD, SQLITE],
    },
    Layer {
        name: "runtime",
        may_use: &["graph"],
        dev_may_use: &[],
        never_links: &[GUI, DISCORD, SQLITE],
    },
    Layer {
        name: "platform-discord",
        may_use: &["runtime"],
        dev_may_use: &[],
        never_links: &[GUI, SQLITE],
    },
    Layer {
        name: "storage-sqlite",
        may_use: &["runtime"],
        dev_may_use: &[],
        never_links: &[GUI, DISCORD],
    },
    Layer {
        name: "exporter",
        may_use: &["graph"],
        dev_may_use: &[],
        never_links: &[GUI, DISCORD, SQLITE],
    },
    Layer {
        name: "runner",
        may_use: &["graph", "runtime", "platform-discord", "storage-sqlite"],
        dev_may_use: &["exporter"],
        never_links: &[GUI],
    },
    Layer {
        name: "desktop",
        may_use: &["graph", "runtime", "exporter"],
        dev_may_use: &[],
        never_links: &[DISCORD, SQLITE],
    },
    Layer {
        name: "xtask",
        may_use: &[],
        dev_may_use: &[],
        never_links: &[],
    },
];

#[derive(Debug, Deserialize)]
pub struct Metadata {
    packages: Vec<Package>,
    workspace_members: Vec<String>,
    resolve: Resolve,
}

#[derive(Debug, Deserialize)]
struct Package {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct Resolve {
    nodes: Vec<Node>,
}

#[derive(Debug, Deserialize)]
struct Node {
    id: String,
    deps: Vec<Dep>,
}

#[derive(Debug, Deserialize)]
struct Dep {
    pkg: String,
    dep_kinds: Vec<DepKind>,
}

#[derive(Debug, Deserialize)]
struct DepKind {
    /// `None` is a normal dependency; otherwise `"dev"` or `"build"`.
    kind: Option<String>,
}

impl Dep {
    /// Whether the dependency is part of what gets built (a normal or build dependency).
    fn is_linked(&self) -> bool {
        self.dep_kinds
            .iter()
            .any(|k| k.kind.as_deref() != Some("dev"))
    }
}

fn matches(pattern: &str, name: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => pattern == name,
    }
}

/// Returns one message per broken rule; empty when the workspace respects the layers.
pub fn check(metadata: &Metadata) -> Vec<String> {
    let names: HashMap<&str, &str> = metadata
        .packages
        .iter()
        .map(|p| (p.id.as_str(), p.name.as_str()))
        .collect();
    let nodes: HashMap<&str, &Node> = metadata
        .resolve
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n))
        .collect();
    let members: HashSet<&str> = metadata
        .workspace_members
        .iter()
        .map(String::as_str)
        .collect();

    let mut violations = Vec::new();
    for id in &metadata.workspace_members {
        let Some(&name) = names.get(id.as_str()) else {
            continue;
        };
        let Some(layer) = LAYERS.iter().find(|l| l.name == name) else {
            violations.push(format!(
                "`{name}` is not registered with a layer: add it to LAYERS in xtask/src/layers.rs"
            ));
            continue;
        };
        let Some(node) = nodes.get(id.as_str()) else {
            continue;
        };

        // The crates of this repository, whatever the kind of dependency.
        for dep in &node.deps {
            let Some(&dep_name) = names.get(dep.pkg.as_str()) else {
                continue;
            };
            let allowed = layer.may_use.contains(&dep_name)
                || (!dep.is_linked() && layer.dev_may_use.contains(&dep_name));
            if members.contains(dep.pkg.as_str()) && !allowed {
                violations.push(format!("`{name}` must not depend on `{dep_name}`"));
            }
        }

        // The external crates it links, directly or through another crate.
        let forbidden: Vec<&str> = layer
            .never_links
            .iter()
            .flat_map(|g| g.iter().copied())
            .collect();
        let mut seen: HashSet<&str> = HashSet::from([id.as_str()]);
        let mut queue: VecDeque<(&str, &str)> = VecDeque::from([(id.as_str(), name)]);
        while let Some((current, via)) = queue.pop_front() {
            let Some(node) = nodes.get(current) else {
                continue;
            };
            for dep in node.deps.iter().filter(|d| d.is_linked()) {
                let Some(&dep_name) = names.get(dep.pkg.as_str()) else {
                    continue;
                };
                if !seen.insert(dep.pkg.as_str()) {
                    continue;
                }
                if forbidden.iter().any(|p| matches(p, dep_name)) {
                    violations.push(format!(
                        "`{name}` must not link `{dep_name}` (through `{via}`)"
                    ));
                }
                queue.push_back((dep.pkg.as_str(), dep_name));
            }
        }
    }
    violations.sort();
    violations.dedup();
    violations
}

/// Reads `cargo metadata` and fails with the list of broken rules.
pub fn run() -> Result<()> {
    let json = run_capture("cargo", &["metadata", "--format-version", "1"])
        .context("could not read the workspace with `cargo metadata`")?;
    let metadata: Metadata =
        serde_json::from_str(&json).context("could not understand the `cargo metadata` output")?;
    let violations = check(&metadata);
    if violations.is_empty() {
        println!("layers: ok");
        return Ok(());
    }
    for violation in &violations {
        eprintln!("layers: {violation}");
    }
    bail!(
        "{} crate layer rule(s) broken (docs/ARCHITECTURE.md §2)",
        violations.len()
    )
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    /// A workspace of `members` plus `externals`; `edges` are `(from, to, kind)` with `kind`
    /// `null`, `"dev"` or `"build"`.
    fn metadata(members: &[&str], externals: &[&str], edges: &[(&str, &str, Value)]) -> Metadata {
        let all: Vec<&str> = members.iter().chain(externals).copied().collect();
        let packages: Vec<Value> = all.iter().map(|n| json!({ "id": n, "name": n })).collect();
        let nodes: Vec<Value> = all
            .iter()
            .map(|n| {
                let deps: Vec<Value> = edges
                    .iter()
                    .filter(|(from, _, _)| from == n)
                    .map(|(_, to, kind)| json!({ "pkg": to, "dep_kinds": [{ "kind": kind }] }))
                    .collect();
                json!({ "id": n, "deps": deps })
            })
            .collect();
        serde_json::from_value(json!({
            "packages": packages,
            "workspace_members": members,
            "resolve": { "nodes": nodes },
        }))
        .expect("the test metadata is well formed")
    }

    #[test]
    fn a_workspace_that_follows_the_rules_passes() {
        let m = metadata(
            &["graph", "runtime", "desktop", "xtask"],
            &["serde", "tauri"],
            &[
                ("graph", "serde", Value::Null),
                ("runtime", "graph", Value::Null),
                ("desktop", "runtime", Value::Null),
                ("desktop", "tauri", Value::Null),
                ("xtask", "serde", Value::Null),
            ],
        );
        assert_eq!(check(&m), Vec::<String>::new());
    }

    #[test]
    fn a_lower_layer_depending_on_a_higher_one_fails() {
        let m = metadata(
            &["graph", "runtime"],
            &[],
            &[("graph", "runtime", Value::Null)],
        );
        assert_eq!(check(&m), ["`graph` must not depend on `runtime`"]);
    }

    #[test]
    fn a_dev_dependency_between_layers_also_fails() {
        let m = metadata(
            &["graph", "runtime"],
            &[],
            &[("graph", "runtime", json!("dev"))],
        );
        assert_eq!(check(&m), ["`graph` must not depend on `runtime`"]);
    }

    #[test]
    fn the_runner_may_use_the_exporter_only_in_tests() {
        let dev = metadata(
            &["runner", "exporter"],
            &[],
            &[("runner", "exporter", json!("dev"))],
        );
        assert!(check(&dev).is_empty(), "{:?}", check(&dev));
        let normal = metadata(
            &["runner", "exporter"],
            &[],
            &[("runner", "exporter", Value::Null)],
        );
        assert_eq!(check(&normal), ["`runner` must not depend on `exporter`"]);
        let build = metadata(
            &["runner", "exporter"],
            &[],
            &[("runner", "exporter", json!("build"))],
        );
        assert_eq!(check(&build), ["`runner` must not depend on `exporter`"]);
    }

    #[test]
    fn a_crate_without_a_layer_fails() {
        let m = metadata(&["graph", "mystery"], &[], &[]);
        assert_eq!(
            check(&m),
            ["`mystery` is not registered with a layer: add it to LAYERS in xtask/src/layers.rs"]
        );
    }

    #[test]
    fn runtime_cannot_know_tauri_even_through_another_crate() {
        let m = metadata(
            &["graph", "runtime"],
            &["helper", "tauri"],
            &[
                ("runtime", "helper", Value::Null),
                ("helper", "tauri", Value::Null),
                ("runtime", "graph", Value::Null),
            ],
        );
        assert_eq!(
            check(&m),
            ["`runtime` must not link `tauri` (through `helper`)"]
        );
    }

    #[test]
    fn the_app_cannot_link_twilight_or_sqlite() {
        let m = metadata(
            &["desktop"],
            &["twilight-gateway", "rusqlite"],
            &[
                ("desktop", "twilight-gateway", Value::Null),
                ("desktop", "rusqlite", Value::Null),
            ],
        );
        assert_eq!(
            check(&m),
            [
                "`desktop` must not link `rusqlite` (through `desktop`)",
                "`desktop` must not link `twilight-gateway` (through `desktop`)",
            ]
        );
    }

    #[test]
    fn a_forbidden_crate_used_only_by_tests_is_not_linked() {
        let m = metadata(
            &["runtime"],
            &["tauri"],
            &[("runtime", "tauri", json!("dev"))],
        );
        assert_eq!(check(&m), Vec::<String>::new());
    }

    #[test]
    fn a_dependency_cycle_in_the_graph_does_not_loop_forever() {
        let m = metadata(
            &["runtime"],
            &["a", "b"],
            &[
                ("runtime", "a", Value::Null),
                ("a", "b", Value::Null),
                ("b", "a", Value::Null),
            ],
        );
        assert_eq!(check(&m), Vec::<String>::new());
    }

    #[test]
    fn prefixes_match_only_with_a_trailing_star() {
        assert!(matches("twilight-*", "twilight-http"));
        assert!(!matches("twilight-*", "twilight"));
        assert!(matches("tauri", "tauri"));
        assert!(!matches("tauri", "tauri-build"));
    }
}
