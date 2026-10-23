//! The checks that need the declared variables: the settings of `data.set_variable`.

use std::collections::HashMap;

use graph::{FlowName, Node, VariableType};
use serde_json::Value;

use super::diagnostic::{Code, Diagnostic, clip};

/// Checks that the `variable` of a `data.set_variable` node is declared and that `add` is used
/// on a number. The settings have already matched the schema.
pub(super) fn check_set(
    flow: &FlowName,
    node: &Node,
    declared: &HashMap<String, VariableType>,
    out: &mut Vec<Diagnostic>,
) {
    let Some(Value::String(name)) = node.settings.get("variable") else {
        return;
    };
    let mut push = |path: &str, code: Code, message: String| {
        out.push(Diagnostic {
            flow: Some(flow.clone()),
            node: Some(node.id.clone()),
            path: Some(path.to_owned()),
            code,
            message,
        });
    };
    let Some(kind) = declared.get(name) else {
        push(
            "variable",
            Code::UnknownVariable,
            format!("`{}` is not a declared variable", clip(name)),
        );
        return;
    };
    let adding = matches!(node.settings.get("operation"), Some(Value::String(op)) if op == "add");
    if adding && !matches!(kind, VariableType::Integer | VariableType::Decimal) {
        push(
            "operation",
            Code::AddToNonNumber,
            format!(
                "`add` needs a number, and `{}` does not hold one",
                clip(name)
            ),
        );
    }
}
