use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use graph::{Variable, VariableName, VariableType};

use super::{
    Storage, StorageError, StoredScope, StoredValue, TypeChange, VarKey, VarRef, persistent,
    type_change, type_name,
};

/// A storage that keeps everything in memory, for tests. A clone shares the same data, so a test
/// can start a second runtime on it as a restart that keeps the values.
#[derive(Debug, Clone, Default)]
pub struct MemoryStorage {
    state: Arc<Mutex<State>>,
}

#[derive(Debug, Default)]
struct State {
    types: HashMap<(StoredScope, VariableName), VariableType>,
    values: HashMap<VarKey, StoredValue>,
}

impl MemoryStorage {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> MutexGuard<'_, State> {
        // A panic while the lock was held cannot leave the maps half written: every change is a
        // single insert or remove.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl State {
    /// The type the variable was recorded with, when `value` is of it.
    fn check(&self, key: &VarKey, value: &StoredValue) -> Result<(), StorageError> {
        match self.types.get(&(key.scope, key.name.clone())) {
            Some(kind) if *kind == value.kind() => Ok(()),
            _ => Err(StorageError::UnknownVariable {
                variable: key.variable(),
            }),
        }
    }
}

impl Storage for MemoryStorage {
    async fn check_variables(&self, declared: &[Variable]) -> Result<(), StorageError> {
        let mut state = self.state();
        // All or nothing: the changes are made on copies and kept when every variable passed.
        let mut types = state.types.clone();
        let mut values = state.values.clone();
        for (scope, variable) in persistent(declared) {
            let name = variable.name.clone();
            let Some(stored) = types.get(&(scope, name.clone())).copied() else {
                types.insert((scope, name), variable.kind);
                continue;
            };
            let has_values = values
                .keys()
                .any(|key| key.scope == scope && key.name == name);
            match type_change(stored, variable.kind, has_values) {
                TypeChange::Same => {}
                TypeChange::Convert => {
                    for (key, value) in &mut values {
                        if key.scope == scope && key.name == name {
                            *value = value.clone().into_decimal();
                        }
                    }
                    types.insert((scope, name), variable.kind);
                }
                TypeChange::Replace => {
                    types.insert((scope, name), variable.kind);
                }
                TypeChange::Refuse => {
                    return Err(StorageError::TypeMismatch {
                        variable: format!("{scope}.{name}"),
                        stored: type_name(stored),
                        declared: type_name(variable.kind),
                    });
                }
            }
        }
        state.types = types;
        state.values = values;
        Ok(())
    }

    async fn get_many(&self, keys: &[VarKey]) -> Result<Vec<Option<StoredValue>>, StorageError> {
        let state = self.state();
        Ok(keys
            .iter()
            .map(|key| state.values.get(key).cloned())
            .collect())
    }

    async fn set(&self, key: &VarKey, value: &StoredValue) -> Result<(), StorageError> {
        value.validate()?;
        let mut state = self.state();
        state.check(key, value)?;
        state.values.insert(key.clone(), value.clone());
        Ok(())
    }

    async fn add(
        &self,
        key: &VarKey,
        initial: &StoredValue,
        delta: &StoredValue,
    ) -> Result<StoredValue, StorageError> {
        initial.validate()?;
        delta.validate()?;
        let mut state = self.state();
        state.check(key, initial)?;
        let current = state.values.get(key).unwrap_or(initial);
        let sum = current.checked_add(delta)?;
        state.values.insert(key.clone(), sum.clone());
        Ok(sum)
    }

    async fn reset_variable(&self, variable: &VarRef) -> Result<u64, StorageError> {
        let mut state = self.state();
        let before = state.values.len();
        state
            .values
            .retain(|key, _| !(key.scope == variable.scope && key.name == variable.name));
        let deleted = before - state.values.len();
        state.types.remove(&(variable.scope, variable.name.clone()));
        Ok(u64::try_from(deleted).unwrap_or(u64::MAX))
    }
}
