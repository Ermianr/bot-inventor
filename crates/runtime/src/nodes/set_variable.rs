//! `data.set_variable`: writes a declared variable, or adds to it.

use graph::VariableType;
use serde_json::Value;

use crate::catalog::{FieldKind, FieldSpec, NodeRequires, NodeSpec, OutputSpec, PortSpec};
use crate::platform::Platform;
use crate::run::vars;
use crate::storage::{Storage, StoredValue};

use super::{NodeCx, NodeError, Outcome};

pub(crate) const TYPE_ID: &str = "data.set_variable";

/// `scope.name`: a scope of at most 6 letters, a dot and a name of at most 64.
const MAX_VARIABLE_CHARS: usize = 71;

pub(super) static SPEC: NodeSpec = NodeSpec {
    type_id: TYPE_ID,
    version: 1,
    fields: &[
        FieldSpec {
            name: "variable",
            kind: FieldKind::Text {
                min: 3,
                max: MAX_VARIABLE_CHARS,
                template: false,
            },
            required: true,
        },
        FieldSpec {
            name: "operation",
            kind: FieldKind::Choice(&["set", "add"]),
            required: false,
        },
        FieldSpec {
            name: "value",
            kind: FieldKind::Expression,
            required: true,
        },
    ],
    ports: &[PortSpec { name: "next" }, PortSpec { name: "error" }],
    outputs: &[OutputSpec { name: "value" }],
    requires: NodeRequires::NOTHING,
    trigger: None,
};

/// `set` replaces the value; `add` adds the number to it in one step that no other run can come
/// between, which is what a counter needs. The new value is published as `value`.
pub(super) async fn execute<P: Platform, S: Storage>(
    cx: &mut NodeCx<'_, P, S>,
) -> Result<Outcome, NodeError> {
    let name = cx.text("variable")?;
    let declared = cx
        .decls
        .get(&name)
        .ok_or_else(|| NodeError::invalid("`variable` is not a declared variable"))?
        .clone();
    let adding = match cx.node.settings.get("operation") {
        None => false,
        Some(Value::String(operation)) if operation == "set" => false,
        Some(Value::String(operation)) if operation == "add" => true,
        Some(_) => {
            return Err(NodeError::invalid("`operation` must be `set` or `add`"));
        }
    };
    let value = cx.expression("value")?;
    let value = StoredValue::from_json(declared.kind, &value)
        .map_err(|error| NodeError::invalid(format!("`value`: {error}")))?;

    let stored = if adding {
        if !matches!(declared.kind, VariableType::Integer | VariableType::Decimal) {
            return Err(NodeError::invalid(
                "`operation` add needs a variable that holds a number",
            ));
        }
        vars::add(cx.storage, cx.run, &declared, &value).await?
    } else {
        vars::store(cx.storage, cx.run, &declared, value.clone()).await?;
        value
    };
    let mut outcome = Outcome::next();
    outcome.outputs.insert("value".to_owned(), stored.to_json());
    Ok(outcome)
}
