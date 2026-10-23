//! The schema and its migrations (`docs/ARCHITECTURE.md` §8).
//!
//! The version of the schema is `PRAGMA user_version`. `MIGRATIONS[n]` takes a database from
//! version `n` to version `n + 1`, so the first one creates the tables and the current version is
//! the length of the list. A change to the schema is a new item at the end and a sample database
//! of the previous version in `tests/samples/`.

/// The SQL of each step, run in one transaction with the new version.
pub const MIGRATIONS: &[&str] = &[
    // Version 1. `variable_types` has the type each persistent variable was declared with, and a
    // value is stored only for a variable that has one, with the type it names.
    "
    CREATE TABLE variable_types (
        scope TEXT NOT NULL CHECK (scope IN ('bot', 'server', 'member', 'user')),
        name  TEXT NOT NULL,
        type  TEXT NOT NULL CHECK (type IN ('integer', 'decimal', 'text', 'boolean')),
        PRIMARY KEY (scope, name)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE variables (
        scope TEXT NOT NULL,
        key   TEXT NOT NULL,
        name  TEXT NOT NULL,
        value ANY NOT NULL,
        PRIMARY KEY (scope, key, name),
        FOREIGN KEY (scope, name) REFERENCES variable_types (scope, name)
            ON DELETE CASCADE ON UPDATE CASCADE
    ) STRICT, WITHOUT ROWID;
    ",
];

/// The version of the schema this build writes.
#[must_use]
pub fn current_version() -> u32 {
    u32::try_from(MIGRATIONS.len()).unwrap_or(u32::MAX)
}
