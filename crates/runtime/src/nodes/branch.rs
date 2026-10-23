//! `logic.branch`: follows `true` or `false` by the value of a condition.

use serde_json::Value;

use crate::catalog::{FieldKind, FieldSpec, NodeRequires, NodeSpec, PortSpec};
use crate::platform::Platform;

use super::{NodeCx, NodeError, Outcome};

pub(super) static SPEC: NodeSpec = NodeSpec {
    type_id: "logic.branch",
    version: 1,
    fields: &[FieldSpec {
        name: "condition",
        kind: FieldKind::Expression,
        required: true,
    }],
    ports: &[
        PortSpec { name: "true" },
        PortSpec { name: "false" },
        PortSpec { name: "error" },
    ],
    outputs: &[],
    requires: NodeRequires::NOTHING,
    trigger: None,
};

pub(super) fn execute<P: Platform>(cx: &mut NodeCx<'_, P>) -> Result<Outcome, NodeError> {
    match cx.expression("condition")? {
        Value::Bool(true) => Ok(Outcome::port("true")),
        Value::Bool(false) => Ok(Outcome::port("false")),
        _ => Err(NodeError::invalid("`condition` must give true or false")),
    }
}
