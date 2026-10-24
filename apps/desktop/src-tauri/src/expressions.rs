//! The commands behind the condition builder and the renaming of a node: the names a node can
//! read, a condition written as an expression and read back, and a new alias with its reads.
//!
//! The parsing and the rewriting are in the `runtime` crate; these commands check what the
//! webview sent and map the errors (`docs/DEVELOPMENT-GUIDE.md` §7).

use graph::{FlowName, NodeId, Project};
use runtime::catalog::Registry;
use runtime::compile::{self, NameList};
use runtime::condition::Condition;
use runtime::expr::CelEngine;
use runtime::rename::{self, Renamed};

use crate::editor::EditorError;

fn invalid(error: impl std::fmt::Display) -> EditorError {
    EditorError::InvalidInput(error.to_string())
}

/// The names that an expression of `node` can read, for the lists of the condition builder.
pub fn names(project: &Project, flow: &FlowName, node: &NodeId) -> Result<NameList, EditorError> {
    compile::expression_names(&Registry::builtin(), project, flow, node).map_err(invalid)
}

/// The expression that a condition spells.
pub fn source_of(condition: &Condition) -> Result<String, EditorError> {
    condition.to_source(&CelEngine::new()).map_err(invalid)
}

/// The condition that an expression spells; `None` when it has another shape.
pub fn condition_of(source: &str) -> Result<Option<Condition>, EditorError> {
    Condition::from_source(&CelEngine::new(), source).map_err(invalid)
}

/// Gives a node a new alias and rewrites the reads of the old one in its flow.
pub fn rename(
    project: &Project,
    flow: &FlowName,
    node: &NodeId,
    alias: &str,
) -> Result<Renamed, EditorError> {
    rename::rename_alias(
        &Registry::builtin(),
        &CelEngine::new(),
        project,
        flow,
        node,
        alias,
    )
    .map_err(invalid)
}

/// The names `node` can read.
#[tauri::command]
#[specta::specta]
pub async fn expression_names(
    project: Project,
    flow: FlowName,
    node: NodeId,
) -> Result<NameList, EditorError> {
    names(&project, &flow, &node)
}

/// The expression that a condition of the builder spells.
#[tauri::command]
#[specta::specta]
pub async fn condition_to_source(condition: Condition) -> Result<String, EditorError> {
    source_of(&condition)
}

/// The condition of the builder that an expression spells, or `None` for the advanced mode.
#[tauri::command]
#[specta::specta]
pub async fn condition_from_source(source: String) -> Result<Option<Condition>, EditorError> {
    condition_of(&source)
}

/// Renames a node: its alias, and every read of it in the expressions and templates of the flow.
#[tauri::command]
#[specta::specta]
pub async fn rename_alias(
    project: Project,
    flow: FlowName,
    node: NodeId,
    alias: String,
) -> Result<Renamed, EditorError> {
    rename(&project, &flow, &node, &alias)
}

#[cfg(test)]
mod tests {
    use runtime::condition::{Compare, Join, Operand, Row};

    use super::*;
    use crate::editor::open_in;

    const PING: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../crates/graph/tests/samples/v1/ping"
    );

    fn ping() -> Project {
        open_in(std::path::Path::new(PING))
            .expect("the ping sample opens")
            .project
    }

    fn flow() -> FlowName {
        FlowName::parse("ping").expect("a flow name")
    }

    fn node(id: &str) -> NodeId {
        NodeId::parse(id).expect("a node id")
    }

    #[test]
    fn the_names_of_a_node_come_from_its_flow() {
        let list = names(&ping(), &flow(), &node("n2")).expect("the node exists");
        assert!(list.order_known);
        assert!(list.names.iter().any(|n| n.source == "event.user.id"));
        assert!(matches!(
            names(&ping(), &flow(), &node("zz")),
            Err(EditorError::InvalidInput(_))
        ));
        assert!(matches!(
            names(
                &ping(),
                &FlowName::parse("nope").expect("a name"),
                &node("n2")
            ),
            Err(EditorError::InvalidInput(_))
        ));
    }

    #[test]
    fn a_condition_is_written_and_read_back() {
        let condition = Condition {
            join: Join::All,
            rows: vec![Row::Compare {
                left: Operand::Name(vec!["event".into(), "user".into(), "id".into()]),
                op: Compare::Eq,
                right: Operand::Text("42".into()),
            }],
        };
        let source = source_of(&condition).expect("it is written");
        assert_eq!(source, r#"event.user.id == "42""#);
        assert_eq!(condition_of(&source).expect("it is read"), Some(condition));
        assert!(matches!(
            condition_of("size(event.member.roles) > 1"),
            Ok(None)
        ));
    }

    #[test]
    fn bad_input_is_an_error_and_never_a_panic() {
        let empty = Condition {
            join: Join::All,
            rows: vec![],
        };
        assert!(matches!(
            source_of(&empty),
            Err(EditorError::InvalidInput(_))
        ));
        assert!(matches!(
            condition_of(""),
            Err(EditorError::InvalidInput(_))
        ));
        assert!(matches!(
            condition_of(&"a".repeat(10_000)),
            Err(EditorError::InvalidInput(_))
        ));
        assert!(matches!(
            condition_of("unknown.x == 1"),
            Err(EditorError::InvalidInput(_))
        ));
    }

    #[test]
    fn a_rename_returns_the_new_project_and_refuses_a_bad_alias() {
        let renamed = rename(&ping(), &flow(), &node("n2"), "answer").expect("it renames");
        let node = renamed.project.flows[&flow()]
            .nodes
            .iter()
            .find(|n| n.id.as_str() == "n2")
            .expect("the node is still there");
        assert_eq!(node.alias.as_str(), "answer");
        for bad in ["", "Bad Alias", "ping_command"] {
            assert!(
                matches!(
                    rename(&ping(), &flow(), &self::node("n2"), bad),
                    Err(EditorError::InvalidInput(_))
                ),
                "{bad:?}"
            );
        }
    }
}
