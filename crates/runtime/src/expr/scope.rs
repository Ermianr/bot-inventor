use serde_json::{Map, Value};

use super::{ExprError, MAX_COLLECTION_LEN, MAX_SCOPE_BYTES, MAX_SCOPE_DEPTH, MAX_SCOPE_ITEMS};

/// The data an evaluation can read: the four namespaces of `docs/ARCHITECTURE.md` §4.2.
///
/// Discord ids are text, not numbers. The scope is checked against the size limits when it is
/// built, so an evaluation never starts on data that is too large.
#[derive(Debug, Clone, PartialEq)]
pub struct Scope {
    event: Value,
    steps: Value,
    vars: Value,
    error: Option<Value>,
}

impl Scope {
    /// Builds a scope. `error` is only present on an `error` path.
    pub fn new(
        event: Value,
        steps: Value,
        vars: Value,
        error: Option<Value>,
    ) -> Result<Self, ExprError> {
        let mut budget = Budget::default();
        for value in [&event, &steps, &vars].into_iter().chain(error.as_ref()) {
            budget.add(value)?;
        }
        Ok(Self {
            event,
            steps,
            vars,
            error,
        })
    }

    /// A scope with nothing in it.
    pub fn empty() -> Self {
        Self {
            event: Value::Object(Map::new()),
            steps: Value::Object(Map::new()),
            vars: Value::Object(Map::new()),
            error: None,
        }
    }

    pub(super) fn namespace(&self, name: &str) -> Option<&Value> {
        match name {
            "event" => Some(&self.event),
            "steps" => Some(&self.steps),
            "vars" => Some(&self.vars),
            "error" => self.error.as_ref(),
            _ => None,
        }
    }
}

#[derive(Default)]
struct Budget {
    items: usize,
    bytes: usize,
}

impl Budget {
    /// Walks `root` without recursion, so deeply nested data cannot overflow the stack.
    fn add(&mut self, root: &Value) -> Result<(), ExprError> {
        let mut stack = vec![(root, 1usize)];
        while let Some((value, depth)) = stack.pop() {
            self.items += 1;
            if self.items > MAX_SCOPE_ITEMS {
                return Err(ExprError::ScopeTooLarge("too many values"));
            }
            if depth > MAX_SCOPE_DEPTH {
                return Err(ExprError::ScopeTooLarge("nested too deeply"));
            }
            match value {
                Value::String(text) => self.add_bytes(text.len())?,
                Value::Array(list) => {
                    if list.len() > MAX_COLLECTION_LEN {
                        return Err(ExprError::ScopeTooLarge("a list is too long"));
                    }
                    stack.extend(list.iter().map(|item| (item, depth + 1)));
                }
                Value::Object(map) => {
                    if map.len() > MAX_COLLECTION_LEN {
                        return Err(ExprError::ScopeTooLarge("a map has too many keys"));
                    }
                    for (key, item) in map {
                        self.add_bytes(key.len())?;
                        stack.push((item, depth + 1));
                    }
                }
                Value::Null | Value::Bool(_) | Value::Number(_) => {}
            }
        }
        Ok(())
    }

    fn add_bytes(&mut self, len: usize) -> Result<(), ExprError> {
        self.bytes = self.bytes.saturating_add(len);
        if self.bytes > MAX_SCOPE_BYTES {
            return Err(ExprError::ScopeTooLarge("too much text"));
        }
        Ok(())
    }
}
