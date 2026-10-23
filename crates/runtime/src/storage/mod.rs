//! The `Storage` trait: what the runtime sees of the database (`docs/ARCHITECTURE.md` §8).
//!
//! Persistent variables (`bot`, `server`, `member` and `user` scopes) are kept by a storage.
//! `storage-sqlite` implements it on SQLite; [`MemoryStorage`] implements it for tests. The
//! runtime never sees a connection, a file or a query.
//!
//! A value is a [`StoredValue`], which is one of the four variable types, so a value of another
//! shape cannot be stored. The storage records the declared type of every persistent variable
//! ([`Storage::check_variables`]) and keeps the stored values consistent with it.

mod memory;

use std::fmt;
use std::future::Future;
use std::str::FromStr;

use graph::{Variable, VariableName, VariableScope, VariableType};
use serde_json::{Number, Value};

pub use memory::MemoryStorage;

/// The most characters a text variable holds.
pub const MAX_TEXT_CHARS: usize = 4000;

/// The scopes that are persisted: every scope but `run`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum StoredScope {
    Bot,
    Server,
    Member,
    User,
}

impl StoredScope {
    pub const ALL: [StoredScope; 4] = [Self::Bot, Self::Server, Self::Member, Self::User];

    /// The word the scope is written with in `vars.<scope>.<name>` and in the database.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bot => "bot",
            Self::Server => "server",
            Self::Member => "member",
            Self::User => "user",
        }
    }

    /// The scope of a declared variable, or `None` for `run`, which is never stored.
    #[must_use]
    pub const fn of(scope: VariableScope) -> Option<Self> {
        match scope {
            VariableScope::Run => None,
            VariableScope::Bot => Some(Self::Bot),
            VariableScope::Server => Some(Self::Server),
            VariableScope::Member => Some(Self::Member),
            VariableScope::User => Some(Self::User),
        }
    }

    #[must_use]
    pub fn parse(word: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|scope| scope.as_str() == word)
    }
}

impl fmt::Display for StoredScope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One stored value: the variable, and whose it is.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct VarKey {
    pub scope: StoredScope,
    /// Who the value belongs to: empty for `bot`, the guild id for `server`, `guild:user` for
    /// `member` and the user id for `user`.
    pub key: String,
    pub name: VariableName,
}

impl VarKey {
    /// The name the messages use: `scope.name`.
    #[must_use]
    pub fn variable(&self) -> String {
        format!("{}.{}", self.scope, self.name)
    }
}

/// A variable, whoever it belongs to: what `--reset-variable <scope>.<name>` names.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct VarRef {
    pub scope: StoredScope,
    pub name: VariableName,
}

impl fmt::Display for VarRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.scope, self.name)
    }
}

/// Why `scope.name` does not name a stored variable.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct VarRefError(String);

impl FromStr for VarRef {
    type Err = VarRefError;

    fn from_str(text: &str) -> Result<Self, VarRefError> {
        let (scope, name) = text
            .split_once('.')
            .ok_or_else(|| VarRefError("a variable is written `<scope>.<name>`".to_owned()))?;
        let scope = StoredScope::parse(scope).ok_or_else(|| {
            VarRefError("the scope must be `bot`, `server`, `member` or `user`".to_owned())
        })?;
        let name = VariableName::parse(name).map_err(|error| VarRefError(error.to_string()))?;
        Ok(Self { scope, name })
    }
}

/// A value a variable holds.
#[derive(Debug, Clone, PartialEq)]
pub enum StoredValue {
    Integer(i64),
    Decimal(f64),
    Text(String),
    Boolean(bool),
}

impl StoredValue {
    #[must_use]
    pub fn kind(&self) -> VariableType {
        match self {
            Self::Integer(_) => VariableType::Integer,
            Self::Decimal(_) => VariableType::Decimal,
            Self::Text(_) => VariableType::Text,
            Self::Boolean(_) => VariableType::Boolean,
        }
    }

    /// Reads `value` as a value of `kind`. An integer is accepted for a decimal.
    ///
    /// # Errors
    ///
    /// [`StorageError::Invalid`] when the value has another type, or is a text over
    /// [`MAX_TEXT_CHARS`] characters.
    pub fn from_json(kind: VariableType, value: &Value) -> Result<Self, StorageError> {
        let stored = match (kind, value) {
            (VariableType::Integer, Value::Number(number)) => number.as_i64().map(Self::Integer),
            (VariableType::Decimal, Value::Number(number)) => number.as_f64().map(Self::Decimal),
            (VariableType::Text, Value::String(text)) => Some(Self::Text(text.clone())),
            (VariableType::Boolean, Value::Bool(flag)) => Some(Self::Boolean(*flag)),
            _ => None,
        };
        let stored = stored.ok_or(StorageError::Invalid(match kind {
            VariableType::Integer => "the value must be a whole number",
            VariableType::Decimal => "the value must be a number",
            VariableType::Text => "the value must be text",
            VariableType::Boolean => "the value must be true or false",
        }))?;
        stored.validate()?;
        Ok(stored)
    }

    /// The value as the data an expression reads.
    #[must_use]
    pub fn to_json(&self) -> Value {
        match self {
            Self::Integer(number) => Value::from(*number),
            Self::Decimal(number) => Number::from_f64(*number).map_or(Value::Null, Value::Number),
            Self::Text(text) => Value::String(text.clone()),
            Self::Boolean(flag) => Value::Bool(*flag),
        }
    }

    /// Checks what the type does not: a decimal is finite and a text is not too long.
    ///
    /// # Errors
    ///
    /// [`StorageError::Invalid`] when it is not.
    pub fn validate(&self) -> Result<(), StorageError> {
        match self {
            Self::Decimal(number) if !number.is_finite() => {
                Err(StorageError::Invalid("the value must be a finite number"))
            }
            Self::Text(text) if text.chars().take(MAX_TEXT_CHARS + 1).count() > MAX_TEXT_CHARS => {
                Err(StorageError::Invalid("the text has too many characters"))
            }
            _ => Ok(()),
        }
    }

    /// This value plus `delta`, both integers or both decimals.
    ///
    /// # Errors
    ///
    /// [`StorageError::Overflow`] when the sum does not fit; [`StorageError::Invalid`] when the
    /// two are not numbers of the same type.
    pub fn checked_add(&self, delta: &Self) -> Result<Self, StorageError> {
        match (self, delta) {
            (Self::Integer(a), Self::Integer(b)) => a
                .checked_add(*b)
                .map(Self::Integer)
                .ok_or(StorageError::Overflow),
            (Self::Decimal(a), Self::Decimal(b)) => {
                let sum = a + b;
                if sum.is_finite() {
                    Ok(Self::Decimal(sum))
                } else {
                    Err(StorageError::Overflow)
                }
            }
            _ => Err(StorageError::Invalid(
                "only numbers of one type can be added",
            )),
        }
    }

    /// An integer as the decimal with the same value; any other value as it is.
    #[must_use]
    pub fn into_decimal(self) -> Self {
        match self {
            // Exact up to 2^53, as every conversion of an integer to a decimal.
            Self::Integer(number) => Self::Decimal(number as f64),
            other => other,
        }
    }
}

/// What to do with a variable that is stored with one type and declared with another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeChange {
    /// The same type: nothing to do.
    Same,
    /// Integer to decimal: the stored values are converted.
    Convert,
    /// Another type, but nothing is stored for the variable: only the record changes.
    Replace,
    /// Another type with values stored: refused, and the author resets the variable.
    Refuse,
}

/// The rule of `docs/ARCHITECTURE.md` §8 for a declared type that differs from the stored one.
#[must_use]
pub fn type_change(stored: VariableType, declared: VariableType, has_values: bool) -> TypeChange {
    if stored == declared {
        TypeChange::Same
    } else if !has_values {
        TypeChange::Replace
    } else if (stored, declared) == (VariableType::Integer, VariableType::Decimal) {
        TypeChange::Convert
    } else {
        TypeChange::Refuse
    }
}

/// The word for a type in messages and in the database.
#[must_use]
pub const fn type_name(kind: VariableType) -> &'static str {
    match kind {
        VariableType::Integer => "integer",
        VariableType::Decimal => "decimal",
        VariableType::Text => "text",
        VariableType::Boolean => "boolean",
    }
}

/// The persistent variables of `declared`: the scope and the declaration, in order, with `run`
/// variables left out.
pub fn persistent(declared: &[Variable]) -> impl Iterator<Item = (StoredScope, &Variable)> {
    declared
        .iter()
        .filter_map(|variable| StoredScope::of(variable.scope).map(|scope| (scope, variable)))
}

/// Why a storage could not do what it was asked. The messages name variables and never carry a
/// stored value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StorageError {
    #[error(
        "`{variable}` is stored as {stored} but the bot declares it as {declared}; \
         `--reset-variable {variable}` deletes its stored values"
    )]
    TypeMismatch {
        variable: String,
        stored: &'static str,
        declared: &'static str,
    },
    #[error("`{variable}` was not declared to the storage with this type")]
    UnknownVariable { variable: String },
    #[error("the result does not fit in the variable")]
    Overflow,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("the value stored for `{variable}` does not have its type")]
    Corrupt { variable: String },
    #[error(
        "the database is version {found} and this app understands up to version {supported}; \
         update the app"
    )]
    NewerDatabase { found: u32, supported: u32 },
    #[error("the database file cannot be used: {0}")]
    File(String),
    #[error("the database failed: {0}")]
    Database(String),
    #[error("the storage is closed")]
    Closed,
}

/// Where persistent variables live.
pub trait Storage: Send + Sync + 'static {
    /// Records the type of every persistent variable of `declared` and applies the rule of
    /// [`type_change`] to the ones already recorded, all or nothing. Variables that are stored
    /// but no longer declared are left as they are.
    ///
    /// Call it when the bot starts, before the first run.
    fn check_variables(
        &self,
        declared: &[Variable],
    ) -> impl Future<Output = Result<(), StorageError>> + Send;

    /// The value of each key, in the same order; `None` for a key with no value stored, which
    /// reads as the declared `initial`.
    fn get_many(
        &self,
        keys: &[VarKey],
    ) -> impl Future<Output = Result<Vec<Option<StoredValue>>, StorageError>> + Send;

    /// Stores `value`. It must have the type the variable was declared with.
    fn set(
        &self,
        key: &VarKey,
        value: &StoredValue,
    ) -> impl Future<Output = Result<(), StorageError>> + Send;

    /// Adds `delta` to the value, which reads as `initial` when nothing is stored, and returns
    /// the new value. It is atomic: runs adding at the same time lose no count. It fails with
    /// [`StorageError::Overflow`] instead of wrapping, and then changes nothing.
    fn add(
        &self,
        key: &VarKey,
        initial: &StoredValue,
        delta: &StoredValue,
    ) -> impl Future<Output = Result<StoredValue, StorageError>> + Send;

    /// Deletes the stored values of the variable, whoever they belong to, and forgets its type.
    /// Returns how many values were deleted.
    fn reset_variable(
        &self,
        variable: &VarRef,
    ) -> impl Future<Output = Result<u64, StorageError>> + Send;
}
