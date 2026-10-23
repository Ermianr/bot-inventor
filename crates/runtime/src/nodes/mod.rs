//! The nodes the app ships: each one's schema and executor, side by side
//! (`docs/ARCHITECTURE.md` §5.2).
//!
//! A node is a file in this folder with a `SPEC` (the schema, which compile and the editor read)
//! and an `execute` function (what a run does at the node). Adding one is a file, a line in
//! [`specs`] and a line in [`Kind`]; `docs/CONTRIBUTING.md` §8 has the steps.

mod branch;
mod reply;
mod set_variable;
mod slash_command;

use serde_json::{Map, Value, json};

use crate::catalog::NodeSpec;
use crate::expr::{ExprError, Scope};
use crate::platform::{Platform, PlatformError};
use crate::run::{Compiled, Declarations, PreparedNode, RunState};
use crate::storage::{Storage, StorageError};

pub(crate) use set_variable::TYPE_ID as SET_VARIABLE;

/// The schemas the app ships, for [`Registry::builtin`](crate::catalog::Registry::builtin).
#[must_use]
pub fn builtin_specs() -> &'static [&'static NodeSpec] {
    static SPECS: [&NodeSpec; 4] = [
        &slash_command::SPEC,
        &reply::SPEC,
        &branch::SPEC,
        &set_variable::SPEC,
    ];
    &SPECS
}

/// The node types that have an executor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    SlashCommand,
    Reply,
    Branch,
    SetVariable,
}

impl Kind {
    pub(crate) const ALL: [Kind; 4] = [
        Kind::SlashCommand,
        Kind::Reply,
        Kind::Branch,
        Kind::SetVariable,
    ];

    pub(crate) fn of(type_id: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.spec().type_id == type_id)
    }

    pub(crate) fn spec(self) -> &'static NodeSpec {
        match self {
            Kind::SlashCommand => &slash_command::SPEC,
            Kind::Reply => &reply::SPEC,
            Kind::Branch => &branch::SPEC,
            Kind::SetVariable => &set_variable::SPEC,
        }
    }
}

/// Runs the executor of `kind`.
pub(crate) async fn execute<P: Platform, S: Storage>(
    kind: Kind,
    cx: &mut NodeCx<'_, P, S>,
) -> Result<Outcome, NodeError> {
    match kind {
        Kind::SlashCommand => slash_command::execute(cx),
        Kind::Reply => reply::execute(cx).await,
        Kind::Branch => branch::execute(cx),
        Kind::SetVariable => set_variable::execute(cx).await,
    }
}

/// What a node did: the port the run leaves through and the values it publishes.
#[derive(Debug)]
pub(crate) struct Outcome {
    pub(crate) port: &'static str,
    pub(crate) outputs: Map<String, Value>,
}

impl Outcome {
    pub(crate) fn port(port: &'static str) -> Self {
        Self {
            port,
            outputs: Map::new(),
        }
    }

    pub(crate) fn next() -> Self {
        Self::port("next")
    }
}

/// Why a node failed: the run goes to its `error` port with these as `error.kind` and
/// `error.message`. Messages name the setting and never carry its value or any user text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeError {
    pub(crate) kind: ErrorKind,
    pub(crate) message: String,
}

impl NodeError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::InvalidValue,
            message: message.into(),
        }
    }

    pub(crate) fn as_value(&self) -> Value {
        json!({ "kind": self.kind.as_str(), "message": self.message })
    }
}

impl From<ExprError> for NodeError {
    fn from(error: ExprError) -> Self {
        Self {
            kind: ErrorKind::Expression,
            message: error.to_string(),
        }
    }
}

impl From<StorageError> for NodeError {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::Invalid(_) | StorageError::Overflow => Self::invalid(error.to_string()),
            // These name a variable and never a value.
            StorageError::TypeMismatch { .. }
            | StorageError::UnknownVariable { .. }
            | StorageError::Corrupt { .. } => Self {
                kind: ErrorKind::Storage,
                message: error.to_string(),
            },
            // The detail of a failing database stays out of `error.message`, which a flow can
            // send to a user.
            StorageError::NewerDatabase { .. }
            | StorageError::File(_)
            | StorageError::Database(_)
            | StorageError::Closed => Self {
                kind: ErrorKind::Storage,
                message: "the storage could not carry out the operation".to_owned(),
            },
        }
    }
}

impl From<PlatformError> for NodeError {
    fn from(error: PlatformError) -> Self {
        let kind = match error {
            PlatformError::MissingPermissions => ErrorKind::MissingPermissions,
            PlatformError::Failed => ErrorKind::Platform,
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

/// The values of `error.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    /// An expression could not be evaluated.
    Expression,
    /// A setting or a result has the wrong type or is out of range.
    InvalidValue,
    MissingPermissions,
    /// The platform could not carry out the action.
    Platform,
    /// The storage could not read or write a variable.
    Storage,
}

impl ErrorKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ErrorKind::Expression => "expression",
            ErrorKind::InvalidValue => "invalid_value",
            ErrorKind::MissingPermissions => "missing_permissions",
            ErrorKind::Platform => "platform",
            ErrorKind::Storage => "storage",
        }
    }
}

/// What an executor can reach: the platform, the storage, its node, and the state of the run.
pub(crate) struct NodeCx<'a, P: Platform, S: Storage> {
    pub(crate) platform: &'a P,
    pub(crate) storage: &'a S,
    /// The variables the bot declares.
    pub(crate) decls: &'a Declarations,
    pub(crate) node: &'a PreparedNode,
    pub(crate) run: &'a mut RunState,
    /// `error.kind` and `error.message`, on a path that left an `error` port.
    pub(crate) error: Option<&'a Value>,
}

impl<P: Platform, S: Storage> NodeCx<'_, P, S> {
    /// A text setting. A template is rendered; plain text is returned as it is.
    pub(crate) fn text(&self, field: &str) -> Result<String, NodeError> {
        match self.node.compiled(field) {
            Some(Compiled::Template(template)) => Ok(template.render(&self.scope()?)?),
            Some(Compiled::Expression(_)) => Err(NodeError::invalid(format!(
                "`{field}` holds an expression, not text"
            ))),
            None => match self.node.settings.get(field) {
                Some(Value::String(text)) => Ok(text.clone()),
                Some(_) => Err(NodeError::invalid(format!("`{field}` must be text"))),
                None => Err(NodeError::invalid(format!("`{field}` is missing"))),
            },
        }
    }

    /// The value of an expression setting.
    pub(crate) fn expression(&self, field: &str) -> Result<Value, NodeError> {
        match self.node.compiled(field) {
            Some(Compiled::Expression(expression)) => Ok(expression.evaluate(&self.scope()?)?),
            Some(Compiled::Template(_)) => Err(NodeError::invalid(format!(
                "`{field}` holds text, not an expression"
            ))),
            None => Err(NodeError::invalid(format!("`{field}` is missing"))),
        }
    }

    /// An optional boolean setting; `default` when it is absent.
    pub(crate) fn flag(&self, field: &str, default: bool) -> Result<bool, NodeError> {
        match self.node.settings.get(field) {
            None => Ok(default),
            Some(Value::Bool(flag)) => Ok(*flag),
            Some(_) => Err(NodeError::invalid(format!(
                "`{field}` must be true or false"
            ))),
        }
    }

    fn scope(&self) -> Result<Scope, NodeError> {
        Ok(Scope::new(
            self.run.event.clone(),
            Value::Object(self.run.steps.clone()),
            self.run.vars.clone(),
            self.error.cloned(),
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::Registry;

    #[test]
    fn every_schema_has_an_executor_and_every_executor_has_a_schema() {
        for spec in builtin_specs() {
            let kind = Kind::of(spec.type_id);
            assert!(kind.is_some(), "`{}` has no executor", spec.type_id);
            assert!(std::ptr::eq(kind.map(Kind::spec).unwrap_or(spec), *spec));
        }
        for kind in Kind::ALL {
            let spec = kind.spec();
            assert!(
                builtin_specs()
                    .iter()
                    .any(|other| std::ptr::eq(*other, spec)),
                "the executor of `{}` has no schema in the catalog",
                spec.type_id
            );
            assert!(Registry::builtin().get(spec.type_id, spec.version).is_ok());
        }
        assert_eq!(builtin_specs().len(), Kind::ALL.len());
    }
}
