//! The operations, as they run on the connection of the storage thread.

use runtime::graph::{Variable, VariableName, VariableType};
use runtime::storage::{
    StorageError, StoredScope, StoredValue, TypeChange, VarKey, VarRef, persistent, type_change,
    type_name,
};
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

/// An error of SQLite as one that names no value: its kind, never its message.
pub fn db(error: rusqlite::Error) -> StorageError {
    let what = error.sqlite_error_code().map_or_else(
        || "unexpected result".to_owned(),
        |code| format!("{code:?}"),
    );
    StorageError::Database(what)
}

fn parse_type(word: &str, variable: &str) -> Result<VariableType, StorageError> {
    [
        VariableType::Integer,
        VariableType::Decimal,
        VariableType::Text,
        VariableType::Boolean,
    ]
    .into_iter()
    .find(|kind| type_name(*kind) == word)
    .ok_or_else(|| StorageError::Corrupt {
        variable: variable.to_owned(),
    })
}

/// The value as SQLite stores it. A boolean is the integer 0 or 1.
fn to_sql(value: &StoredValue) -> Value {
    match value {
        StoredValue::Integer(number) => Value::Integer(*number),
        StoredValue::Decimal(number) => Value::Real(*number),
        StoredValue::Text(text) => Value::Text(text.clone()),
        StoredValue::Boolean(flag) => Value::Integer(i64::from(*flag)),
    }
}

/// Reads a stored value back as the type the variable was recorded with.
fn from_sql(kind: &str, value: ValueRef<'_>, key: &VarKey) -> Result<StoredValue, StorageError> {
    let corrupt = || StorageError::Corrupt {
        variable: key.variable(),
    };
    let stored = match (kind, value) {
        ("integer", ValueRef::Integer(number)) => StoredValue::Integer(number),
        ("decimal", ValueRef::Real(number)) => StoredValue::Decimal(number),
        ("text", ValueRef::Text(bytes)) => {
            StoredValue::Text(String::from_utf8(bytes.to_vec()).map_err(|_| corrupt())?)
        }
        ("boolean", ValueRef::Integer(0)) => StoredValue::Boolean(false),
        ("boolean", ValueRef::Integer(1)) => StoredValue::Boolean(true),
        _ => return Err(corrupt()),
    };
    stored.validate().map_err(|_| corrupt())?;
    Ok(stored)
}

/// The persistent variables of `declared`, as the storage thread owns them.
pub fn declarations(declared: &[Variable]) -> Vec<(StoredScope, VariableName, VariableType)> {
    persistent(declared)
        .map(|(scope, variable)| (scope, variable.name.clone(), variable.kind))
        .collect()
}

pub fn check_variables(
    conn: &mut Connection,
    declared: &[(StoredScope, VariableName, VariableType)],
) -> Result<(), StorageError> {
    // All or nothing: a refusal drops the transaction, and nothing it did is kept.
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    for (scope, name, kind) in declared {
        let variable = format!("{scope}.{name}");
        let stored: Option<String> = tx
            .query_row(
                "SELECT type FROM variable_types WHERE scope = ?1 AND name = ?2",
                params![scope.as_str(), name.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(db)?;
        let Some(stored) = stored else {
            record(&tx, *scope, name, *kind, false)?;
            continue;
        };
        let stored = parse_type(&stored, &variable)?;
        let has_values: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM variables WHERE scope = ?1 AND name = ?2)",
                params![scope.as_str(), name.as_str()],
                |row| row.get(0),
            )
            .map_err(db)?;
        match type_change(stored, *kind, has_values) {
            TypeChange::Same => {}
            TypeChange::Convert => {
                tx.execute(
                    "UPDATE variables SET value = CAST(value AS REAL) WHERE scope = ?1 AND name = ?2",
                    params![scope.as_str(), name.as_str()],
                )
                .map_err(db)?;
                record(&tx, *scope, name, *kind, true)?;
            }
            TypeChange::Replace => record(&tx, *scope, name, *kind, true)?,
            TypeChange::Refuse => {
                return Err(StorageError::TypeMismatch {
                    variable,
                    stored: type_name(stored),
                    declared: type_name(*kind),
                });
            }
        }
    }
    tx.commit().map_err(db)
}

fn record(
    tx: &Transaction<'_>,
    scope: StoredScope,
    name: &VariableName,
    kind: VariableType,
    exists: bool,
) -> Result<(), StorageError> {
    let sql = if exists {
        "UPDATE variable_types SET type = ?3 WHERE scope = ?1 AND name = ?2"
    } else {
        "INSERT INTO variable_types (scope, name, type) VALUES (?1, ?2, ?3)"
    };
    tx.execute(sql, params![scope.as_str(), name.as_str(), type_name(kind)])
        .map_err(db)?;
    Ok(())
}

pub fn get_many(
    conn: &mut Connection,
    keys: &[VarKey],
) -> Result<Vec<Option<StoredValue>>, StorageError> {
    // One snapshot for the whole batch.
    let tx = conn.transaction().map_err(db)?;
    let mut statement = tx
        .prepare(
            "SELECT t.type, v.value FROM variables v \
             JOIN variable_types t ON t.scope = v.scope AND t.name = v.name \
             WHERE v.scope = ?1 AND v.key = ?2 AND v.name = ?3",
        )
        .map_err(db)?;
    keys.iter()
        .map(|key| {
            statement
                .query_row(
                    params![key.scope.as_str(), key.key, key.name.as_str()],
                    |row| {
                        let kind: String = row.get(0)?;
                        Ok(from_sql(&kind, row.get_ref(1)?, key))
                    },
                )
                .optional()
                .map_err(db)?
                .transpose()
        })
        .collect()
}

pub fn set(conn: &mut Connection, key: &VarKey, value: &StoredValue) -> Result<(), StorageError> {
    value.validate()?;
    let changed = conn
        .execute(
            "INSERT INTO variables (scope, key, name, value) \
             SELECT ?1, ?2, ?3, ?4 FROM variable_types \
             WHERE scope = ?1 AND name = ?3 AND type = ?5 \
             ON CONFLICT (scope, key, name) DO UPDATE SET value = excluded.value",
            params![
                key.scope.as_str(),
                key.key,
                key.name.as_str(),
                to_sql(value),
                type_name(value.kind())
            ],
        )
        .map_err(db)?;
    if changed == 0 {
        return Err(StorageError::UnknownVariable {
            variable: key.variable(),
        });
    }
    Ok(())
}

/// The largest finite decimal, written out so a sum that overflows to infinity is refused.
const MAX_DECIMAL: &str = "1.7976931348623157e308";

pub fn add(
    conn: &mut Connection,
    key: &VarKey,
    initial: &StoredValue,
    delta: &StoredValue,
) -> Result<StoredValue, StorageError> {
    initial.validate()?;
    delta.validate()?;
    // The first value is `initial + delta`, worked out here; an existing one is added to in the
    // same statement that stores it, so no other run can come between the read and the write.
    // A sum that does not stay a finite number of the same type changes nothing.
    let first = initial.checked_add(delta)?;
    let sql = format!(
        "INSERT INTO variables (scope, key, name, value) \
         SELECT ?1, ?2, ?3, ?4 FROM variable_types \
         WHERE scope = ?1 AND name = ?3 AND type = ?5 \
         ON CONFLICT (scope, key, name) DO UPDATE SET value = value + ?6 \
         WHERE typeof(value + ?6) = typeof(value) \
         AND value + ?6 BETWEEN -{MAX_DECIMAL} AND {MAX_DECIMAL} \
         RETURNING value"
    );
    let sum = conn
        .query_row(
            &sql,
            params![
                key.scope.as_str(),
                key.key,
                key.name.as_str(),
                to_sql(&first),
                type_name(initial.kind()),
                to_sql(delta)
            ],
            |row| Ok(from_sql(type_name(initial.kind()), row.get_ref(0)?, key)),
        )
        .optional()
        .map_err(db)?;
    if let Some(sum) = sum {
        return sum;
    }
    // Nothing was returned: either the variable is not recorded with this type, or the sum
    // does not fit.
    let recorded: Option<String> = conn
        .query_row(
            "SELECT type FROM variable_types WHERE scope = ?1 AND name = ?2",
            params![key.scope.as_str(), key.name.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    if recorded.as_deref() == Some(type_name(initial.kind())) {
        Err(StorageError::Overflow)
    } else {
        Err(StorageError::UnknownVariable {
            variable: key.variable(),
        })
    }
}

pub fn reset_variable(conn: &mut Connection, variable: &VarRef) -> Result<u64, StorageError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let values: i64 = tx
        .query_row(
            "SELECT count(*) FROM variables WHERE scope = ?1 AND name = ?2",
            params![variable.scope.as_str(), variable.name.as_str()],
            |row| row.get(0),
        )
        .map_err(db)?;
    // The values go with the type: they reference it.
    tx.execute(
        "DELETE FROM variable_types WHERE scope = ?1 AND name = ?2",
        params![variable.scope.as_str(), variable.name.as_str()],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(u64::try_from(values).unwrap_or(0))
}
