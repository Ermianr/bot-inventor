//! The variables of a run: what is declared, which ones a node reads, and how they reach the
//! storage (`docs/ARCHITECTURE.md` §4.3).

use std::collections::{HashMap, HashSet};

use graph::{Variable, VariableName, VariableScope, VariableType};
use serde_json::{Map, Value};

use crate::expr::References;
use crate::nodes::NodeError;
use crate::storage::{Storage, StorageError, StoredScope, StoredValue, VarKey};

use super::PreparedNode;

/// A declared variable, with its initial value already in the shape of its type.
#[derive(Debug, Clone)]
pub(crate) struct Declared {
    pub(crate) scope: VariableScope,
    pub(crate) name: VariableName,
    pub(crate) kind: VariableType,
    /// What the variable reads as until something is written to it.
    pub(crate) initial: Value,
}

impl Declared {
    /// The scope the variable is stored under, or `None` for a `run` variable.
    pub(crate) fn stored_scope(&self) -> Option<StoredScope> {
        StoredScope::of(self.scope)
    }

    /// `scope.name`, as the messages and the `variable` setting write it.
    pub(crate) fn qualified(&self) -> String {
        qualified(self.scope, &self.name)
    }

    /// The initial value as a value to store.
    pub(crate) fn initial_value(&self) -> Result<StoredValue, NodeError> {
        StoredValue::from_json(self.kind, &self.initial).map_err(|_| {
            NodeError::invalid(format!(
                "the initial value of `{}` does not have its type",
                self.qualified()
            ))
        })
    }
}

fn qualified(scope: VariableScope, name: &VariableName) -> String {
    format!("{}.{name}", scope_word(scope))
}

pub(crate) fn scope_word(scope: VariableScope) -> &'static str {
    match scope {
        VariableScope::Run => "run",
        VariableScope::Bot => "bot",
        VariableScope::Server => "server",
        VariableScope::Member => "member",
        VariableScope::User => "user",
    }
}

/// The variables a payload declares.
#[derive(Debug, Default)]
pub(crate) struct Declarations {
    by_name: HashMap<String, Declared>,
    /// `scope.name` of each one, in the order of the payload.
    order: Vec<String>,
}

impl Declarations {
    pub(crate) fn new(variables: &[Variable]) -> Self {
        let mut declarations = Self::default();
        for variable in variables {
            let key = qualified(variable.scope, &variable.name);
            if declarations.by_name.contains_key(&key) {
                continue;
            }
            // A decimal declared with a whole number reads as a decimal.
            let initial = StoredValue::from_json(variable.kind, &variable.initial)
                .map_or_else(|_| variable.initial.clone(), |stored| stored.to_json());
            declarations.by_name.insert(
                key.clone(),
                Declared {
                    scope: variable.scope,
                    name: variable.name.clone(),
                    kind: variable.kind,
                    initial,
                },
            );
            declarations.order.push(key);
        }
        declarations
    }

    /// The variable written `scope.name`.
    pub(crate) fn get(&self, qualified: &str) -> Option<&Declared> {
        self.by_name.get(qualified)
    }

    fn all(&self) -> impl Iterator<Item = &Declared> {
        self.order.iter().filter_map(|key| self.by_name.get(key))
    }

    /// The `vars` namespace of a new run: `{scope: {name: initial}}`.
    pub(crate) fn namespace(&self) -> Value {
        let mut scopes: Map<String, Value> = Map::new();
        for declared in self.all() {
            if let Value::Object(names) = scopes
                .entry(scope_word(declared.scope))
                .or_insert_with(|| Value::Object(Map::new()))
            {
                names.insert(declared.name.as_str().to_owned(), declared.initial.clone());
            }
        }
        Value::Object(scopes)
    }

    /// The persistent variables the expressions behind `references` read. A path that stops
    /// before the name (a payload that skipped compile) reads everything under it.
    pub(crate) fn reads(&self, references: &References) -> Vec<Declared> {
        let wanted: Vec<&[String]> = references
            .paths()
            .filter(|path| path.root() == "vars")
            .map(|path| path.segments().get(1..).unwrap_or_default())
            .collect();
        self.all()
            .filter(|declared| declared.stored_scope().is_some())
            .filter(|declared| {
                wanted.iter().any(|rest| match rest {
                    [] => true,
                    [scope] => scope == scope_word(declared.scope),
                    [scope, name, ..] => {
                        scope == scope_word(declared.scope) && name == declared.name.as_str()
                    }
                })
            })
            .cloned()
            .collect()
    }
}

/// What a run knows about its variables, besides the values in its `vars` namespace.
#[derive(Debug, Default)]
pub(crate) struct Loaded {
    /// The persistent variables whose stored value is already in `vars`.
    fetched: HashSet<(StoredScope, VariableName)>,
}

impl Loaded {
    fn has(&self, scope: StoredScope, name: &VariableName) -> bool {
        self.fetched.contains(&(scope, name.clone()))
    }

    fn mark(&mut self, scope: StoredScope, name: &VariableName) {
        self.fetched.insert((scope, name.clone()));
    }
}

/// Puts `value` in the `vars` namespace of a run.
pub(crate) fn put(vars: &mut Value, declared: &Declared, value: Value) {
    let Value::Object(scopes) = vars else {
        return;
    };
    if let Value::Object(names) = scopes
        .entry(scope_word(declared.scope))
        .or_insert_with(|| Value::Object(Map::new()))
    {
        names.insert(declared.name.as_str().to_owned(), value);
    }
}

/// The value of a variable in the `vars` namespace of a run.
pub(crate) fn current(vars: &Value, declared: &Declared) -> Option<StoredValue> {
    let value = vars
        .get(scope_word(declared.scope))?
        .get(declared.name.as_str())?;
    StoredValue::from_json(declared.kind, value).ok()
}

/// Who a value of `scope` belongs to, read from the event: ids of at most 20 digits, the shape of
/// a Discord id, so a `guild:user` key cannot be ambiguous.
fn owner(scope: StoredScope, event: &Value) -> Result<String, NodeError> {
    let id = |who: &str, what: &str| {
        event
            .get(who)
            .and_then(|who| who.get("id"))
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()))
            .ok_or_else(|| {
                NodeError::invalid(format!(
                    "the event has no {what} id, which `{scope}` variables need"
                ))
            })
    };
    Ok(match scope {
        StoredScope::Bot => String::new(),
        StoredScope::Server => id("guild", "server")?.to_owned(),
        StoredScope::User => id("user", "user")?.to_owned(),
        StoredScope::Member => format!("{}:{}", id("guild", "server")?, id("user", "user")?),
    })
}

/// The key of the value of `declared` for the event of a run.
pub(crate) fn key(declared: &Declared, event: &Value) -> Result<VarKey, NodeError> {
    let scope = declared
        .stored_scope()
        .ok_or_else(|| NodeError::invalid(format!("`{}` is not stored", declared.qualified())))?;
    Ok(VarKey {
        scope,
        key: owner(scope, event)?,
        name: declared.name.clone(),
    })
}

/// Reads the persistent variables `node` reads that the run does not have yet, in one batch.
pub(super) async fn load<S: Storage>(
    storage: &S,
    node: &PreparedNode,
    state: &mut super::RunState,
) -> Result<(), NodeError> {
    let mut pending = Vec::new();
    let mut keys = Vec::new();
    for declared in &node.reads {
        let Some(scope) = declared.stored_scope() else {
            continue;
        };
        if state.loaded.has(scope, &declared.name) {
            continue;
        }
        keys.push(key(declared, &state.event)?);
        pending.push(declared);
    }
    if keys.is_empty() {
        return Ok(());
    }
    let values = storage.get_many(&keys).await?;
    if values.len() != keys.len() {
        return Err(StorageError::Closed.into());
    }
    for (declared, value) in pending.into_iter().zip(values) {
        if let Some(value) = value {
            if value.kind() != declared.kind {
                return Err(StorageError::Corrupt {
                    variable: declared.qualified(),
                }
                .into());
            }
            put(&mut state.vars, declared, value.to_json());
        }
        if let Some(scope) = declared.stored_scope() {
            state.loaded.mark(scope, &declared.name);
        }
    }
    Ok(())
}

/// Writes `value` to `declared`, in the storage when it is persistent, and in the run.
pub(crate) async fn store<S: Storage>(
    storage: &S,
    state: &mut super::RunState,
    declared: &Declared,
    value: StoredValue,
) -> Result<(), NodeError> {
    if let Some(scope) = declared.stored_scope() {
        storage.set(&key(declared, &state.event)?, &value).await?;
        state.loaded.mark(scope, &declared.name);
    }
    put(&mut state.vars, declared, value.to_json());
    Ok(())
}

/// Adds `delta` to `declared` and returns the new value.
pub(crate) async fn add<S: Storage>(
    storage: &S,
    state: &mut super::RunState,
    declared: &Declared,
    delta: &StoredValue,
) -> Result<StoredValue, NodeError> {
    let initial = declared.initial_value()?;
    let sum = if let Some(scope) = declared.stored_scope() {
        let sum = storage
            .add(&key(declared, &state.event)?, &initial, delta)
            .await?;
        state.loaded.mark(scope, &declared.name);
        sum
    } else {
        current(&state.vars, declared)
            .unwrap_or(initial)
            .checked_add(delta)?
    };
    put(&mut state.vars, declared, sum.to_json());
    Ok(sum)
}
