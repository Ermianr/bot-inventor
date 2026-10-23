//! The storage on a real SQLite file in a temporary folder.
#![allow(clippy::unwrap_used, clippy::panic)]

use std::path::{Path, PathBuf};

use runtime::graph::{Variable, VariableName, VariableScope, VariableType};
use runtime::storage::{
    MAX_TEXT_CHARS, Storage, StorageError, StoredScope, StoredValue, VarKey, VarRef,
};
use rusqlite::Connection;
use serde_json::{Value, json};
use storage_sqlite::{MIGRATIONS, SqliteStorage, current_version};
use tempfile::TempDir;

fn var(scope: VariableScope, name: &str, kind: VariableType, initial: Value) -> Variable {
    Variable {
        name: VariableName::parse(name).unwrap(),
        kind,
        scope,
        initial,
    }
}

fn key(scope: StoredScope, owner: &str, name: &str) -> VarKey {
    VarKey {
        scope,
        key: owner.to_owned(),
        name: VariableName::parse(name).unwrap(),
    }
}

fn reference(text: &str) -> VarRef {
    text.parse().unwrap()
}

fn declared() -> Vec<Variable> {
    vec![
        var(VariableScope::Bot, "motto", VariableType::Text, json!("hi")),
        var(
            VariableScope::Server,
            "visits",
            VariableType::Integer,
            json!(0),
        ),
        var(
            VariableScope::Member,
            "warnings",
            VariableType::Integer,
            json!(0),
        ),
        var(
            VariableScope::User,
            "ratio",
            VariableType::Decimal,
            json!(0.0),
        ),
        var(
            VariableScope::User,
            "vip",
            VariableType::Boolean,
            json!(false),
        ),
        // A `run` variable is never stored.
        var(VariableScope::Run, "tmp", VariableType::Text, json!("")),
    ]
}

struct Folder {
    dir: TempDir,
}

impl Folder {
    fn new() -> Self {
        Self {
            dir: TempDir::new().unwrap(),
        }
    }

    fn db(&self) -> PathBuf {
        self.dir.path().join("bot.sqlite")
    }

    async fn open(&self) -> SqliteStorage {
        let storage = SqliteStorage::open(&self.db()).unwrap();
        storage.check_variables(&declared()).await.unwrap();
        storage
    }

    fn names(&self) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(self.dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }
}

async fn get(storage: &SqliteStorage, key: &VarKey) -> Option<StoredValue> {
    storage
        .get_many(std::slice::from_ref(key))
        .await
        .unwrap()
        .remove(0)
}

// ---- Survives a restart -----------------------------------------------------------------------

#[tokio::test]
async fn values_survive_closing_and_opening_the_file_again() {
    let folder = Folder::new();
    let visits = key(StoredScope::Server, "100", "visits");
    let motto = key(StoredScope::Bot, "", "motto");
    let ratio = key(StoredScope::User, "42", "ratio");
    let vip = key(StoredScope::User, "42", "vip");
    {
        let storage = folder.open().await;
        storage
            .set(&visits, &StoredValue::Integer(41))
            .await
            .unwrap();
        storage
            .set(&motto, &StoredValue::Text("héllo ✓".to_owned()))
            .await
            .unwrap();
        storage
            .set(&ratio, &StoredValue::Decimal(0.25))
            .await
            .unwrap();
        storage
            .set(&vip, &StoredValue::Boolean(true))
            .await
            .unwrap();
        let sum = storage
            .add(&visits, &StoredValue::Integer(0), &StoredValue::Integer(1))
            .await
            .unwrap();
        assert_eq!(sum, StoredValue::Integer(42));
        // The last handle is dropped here: the connection is closed.
    }
    let storage = folder.open().await;
    let keys = [
        visits,
        motto,
        ratio,
        vip,
        key(StoredScope::Server, "999", "visits"),
    ];
    assert_eq!(
        storage.get_many(&keys).await.unwrap(),
        vec![
            Some(StoredValue::Integer(42)),
            Some(StoredValue::Text("héllo ✓".to_owned())),
            Some(StoredValue::Decimal(0.25)),
            Some(StoredValue::Boolean(true)),
            None,
        ]
    );
}

#[tokio::test]
async fn a_value_is_kept_for_each_owner() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let owners = [
        key(StoredScope::Member, "100:42", "warnings"),
        key(StoredScope::Member, "100:43", "warnings"),
        key(StoredScope::Member, "101:42", "warnings"),
    ];
    for (number, owner) in owners.iter().enumerate() {
        let number = i64::try_from(number).unwrap();
        storage
            .set(owner, &StoredValue::Integer(number + 1))
            .await
            .unwrap();
    }
    let user_vip = key(StoredScope::User, "42", "vip");
    storage
        .set(&user_vip, &StoredValue::Boolean(true))
        .await
        .unwrap();
    assert_eq!(
        storage.get_many(&owners).await.unwrap(),
        vec![
            Some(StoredValue::Integer(1)),
            Some(StoredValue::Integer(2)),
            Some(StoredValue::Integer(3))
        ]
    );
    assert_eq!(
        get(&storage, &key(StoredScope::User, "43", "vip")).await,
        None
    );
}

#[tokio::test]
async fn the_file_is_private_and_a_link_is_refused() {
    let folder = Folder::new();
    drop(folder.open().await);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(folder.db()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    #[cfg(unix)]
    {
        let link = folder.dir.path().join("link.sqlite");
        std::os::unix::fs::symlink(folder.db(), &link).unwrap();
        assert!(matches!(
            SqliteStorage::open(&link),
            Err(StorageError::File(_))
        ));
    }
    assert!(matches!(
        SqliteStorage::open(folder.dir.path()),
        Err(StorageError::File(_))
    ));
}

// ---- The atomic counter -----------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_counter_loses_no_count_under_concurrent_runs() {
    const TASKS: i64 = 64;
    const EACH: i64 = 25;
    let folder = Folder::new();
    let storage = folder.open().await;
    let visits = key(StoredScope::Server, "100", "visits");
    let handles: Vec<_> = (0..TASKS)
        .map(|_| {
            let storage = storage.clone();
            let visits = visits.clone();
            tokio::spawn(async move {
                for _ in 0..EACH {
                    storage
                        .add(&visits, &StoredValue::Integer(0), &StoredValue::Integer(1))
                        .await
                        .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.await.unwrap();
    }
    assert_eq!(
        get(&storage, &visits).await,
        Some(StoredValue::Integer(TASKS * EACH))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_counter_loses_no_count_between_two_connections() {
    const EACH: i64 = 200;
    let folder = Folder::new();
    let first = folder.open().await;
    let second = folder.open().await;
    let visits = key(StoredScope::Server, "100", "visits");
    let handles: Vec<_> = [first.clone(), second.clone()]
        .into_iter()
        .map(|storage| {
            let visits = visits.clone();
            tokio::spawn(async move {
                for _ in 0..EACH {
                    storage
                        .add(&visits, &StoredValue::Integer(0), &StoredValue::Integer(1))
                        .await
                        .unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.await.unwrap();
    }
    assert_eq!(
        get(&first, &visits).await,
        Some(StoredValue::Integer(2 * EACH))
    );
}

#[tokio::test]
async fn the_counter_starts_from_initial_and_takes_negative_and_decimal_steps() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let visits = key(StoredScope::Server, "100", "visits");
    let sum = storage
        .add(
            &visits,
            &StoredValue::Integer(10),
            &StoredValue::Integer(-3),
        )
        .await
        .unwrap();
    assert_eq!(sum, StoredValue::Integer(7));
    let ratio = key(StoredScope::User, "42", "ratio");
    storage
        .add(
            &ratio,
            &StoredValue::Decimal(1.5),
            &StoredValue::Decimal(0.25),
        )
        .await
        .unwrap();
    let sum = storage
        .add(
            &ratio,
            &StoredValue::Decimal(1.5),
            &StoredValue::Decimal(0.25),
        )
        .await
        .unwrap();
    assert_eq!(sum, StoredValue::Decimal(2.0));
}

#[tokio::test]
async fn the_counter_fails_instead_of_wrapping_and_changes_nothing() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let visits = key(StoredScope::Server, "100", "visits");
    storage
        .set(&visits, &StoredValue::Integer(i64::MAX - 1))
        .await
        .unwrap();
    let result = storage
        .add(&visits, &StoredValue::Integer(0), &StoredValue::Integer(2))
        .await;
    assert_eq!(result, Err(StorageError::Overflow));
    assert_eq!(
        get(&storage, &visits).await,
        Some(StoredValue::Integer(i64::MAX - 1))
    );
    // The first value can overflow too.
    let other = key(StoredScope::Server, "101", "visits");
    let result = storage
        .add(
            &other,
            &StoredValue::Integer(i64::MAX),
            &StoredValue::Integer(1),
        )
        .await;
    assert_eq!(result, Err(StorageError::Overflow));
    assert_eq!(get(&storage, &other).await, None);
    // And a decimal that would become infinite.
    let ratio = key(StoredScope::User, "42", "ratio");
    storage
        .set(&ratio, &StoredValue::Decimal(f64::MAX))
        .await
        .unwrap();
    let result = storage
        .add(
            &ratio,
            &StoredValue::Decimal(0.0),
            &StoredValue::Decimal(f64::MAX),
        )
        .await;
    assert_eq!(result, Err(StorageError::Overflow));
    assert_eq!(
        get(&storage, &ratio).await,
        Some(StoredValue::Decimal(f64::MAX))
    );
}

#[tokio::test]
async fn the_counter_only_adds_numbers_of_the_type_of_the_variable() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let visits = key(StoredScope::Server, "100", "visits");
    let text = StoredValue::Text("a".to_owned());
    assert!(matches!(
        storage.add(&visits, &text, &text).await,
        Err(StorageError::Invalid(_))
    ));
    // A decimal step on an integer variable is not an integer variable's step.
    let result = storage
        .add(
            &visits,
            &StoredValue::Decimal(0.0),
            &StoredValue::Decimal(1.0),
        )
        .await;
    assert!(matches!(result, Err(StorageError::UnknownVariable { .. })));
    assert_eq!(get(&storage, &visits).await, None);
}

#[tokio::test]
async fn a_value_needs_a_variable_that_was_declared_with_its_type() {
    let folder = Folder::new();
    let storage = SqliteStorage::open(&folder.db()).unwrap();
    let visits = key(StoredScope::Server, "100", "visits");
    // Nothing was declared to the storage yet.
    assert!(matches!(
        storage.set(&visits, &StoredValue::Integer(1)).await,
        Err(StorageError::UnknownVariable { .. })
    ));
    storage.check_variables(&declared()).await.unwrap();
    assert!(matches!(
        storage
            .set(&visits, &StoredValue::Text("1".to_owned()))
            .await,
        Err(StorageError::UnknownVariable { .. })
    ));
    let undeclared = key(StoredScope::Server, "100", "other");
    assert!(matches!(
        storage.set(&undeclared, &StoredValue::Integer(1)).await,
        Err(StorageError::UnknownVariable { .. })
    ));
    assert_eq!(get(&storage, &visits).await, None);
}

#[tokio::test]
async fn a_text_has_a_limit_and_a_decimal_is_finite() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let motto = key(StoredScope::Bot, "", "motto");
    let longest = StoredValue::Text("ñ".repeat(MAX_TEXT_CHARS));
    storage.set(&motto, &longest).await.unwrap();
    assert_eq!(get(&storage, &motto).await, Some(longest));
    let too_long = StoredValue::Text("a".repeat(MAX_TEXT_CHARS + 1));
    assert!(matches!(
        storage.set(&motto, &too_long).await,
        Err(StorageError::Invalid(_))
    ));
    let ratio = key(StoredScope::User, "42", "ratio");
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(matches!(
            storage.set(&ratio, &StoredValue::Decimal(bad)).await,
            Err(StorageError::Invalid(_))
        ));
    }
}

#[tokio::test]
async fn a_row_of_the_wrong_type_is_reported_and_names_the_variable() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let visits = key(StoredScope::Server, "100", "visits");
    storage
        .set(&visits, &StoredValue::Integer(1))
        .await
        .unwrap();
    let raw = Connection::open(folder.db()).unwrap();
    raw.execute(
        "UPDATE variables SET value = 'many' WHERE name = 'visits'",
        [],
    )
    .unwrap();
    let error = storage.get_many(&[visits]).await.unwrap_err();
    assert_eq!(
        error,
        StorageError::Corrupt {
            variable: "server.visits".to_owned()
        }
    );
    assert!(!error.to_string().contains("many"));
}

// ---- Types ------------------------------------------------------------------------------------

#[tokio::test]
async fn integer_to_decimal_converts_what_is_stored() {
    let folder = Folder::new();
    let warnings = key(StoredScope::Member, "100:42", "warnings");
    {
        let storage = folder.open().await;
        storage
            .set(&warnings, &StoredValue::Integer(3))
            .await
            .unwrap();
        storage
            .set(
                &key(StoredScope::Member, "100:43", "warnings"),
                &StoredValue::Integer(-1),
            )
            .await
            .unwrap();
    }
    let storage = SqliteStorage::open(&folder.db()).unwrap();
    let mut changed = declared();
    changed[2] = var(
        VariableScope::Member,
        "warnings",
        VariableType::Decimal,
        json!(0),
    );
    storage.check_variables(&changed).await.unwrap();
    assert_eq!(
        get(&storage, &warnings).await,
        Some(StoredValue::Decimal(3.0))
    );
    assert_eq!(
        get(&storage, &key(StoredScope::Member, "100:43", "warnings")).await,
        Some(StoredValue::Decimal(-1.0))
    );
    // It is a decimal from now on, and it can be added to as one.
    let sum = storage
        .add(
            &warnings,
            &StoredValue::Decimal(0.0),
            &StoredValue::Decimal(0.5),
        )
        .await
        .unwrap();
    assert_eq!(sum, StoredValue::Decimal(3.5));
}

#[tokio::test]
async fn another_change_of_type_is_refused_with_the_name_of_the_variable() {
    let folder = Folder::new();
    let visits = key(StoredScope::Server, "100", "visits");
    {
        let storage = folder.open().await;
        storage
            .set(&visits, &StoredValue::Integer(5))
            .await
            .unwrap();
    }
    let storage = SqliteStorage::open(&folder.db()).unwrap();
    let cases = [
        (VariableType::Text, json!("x"), "text"),
        (VariableType::Boolean, json!(false), "boolean"),
    ];
    for (kind, initial, word) in cases {
        let mut changed = declared();
        changed[1] = var(VariableScope::Server, "visits", kind, initial);
        let error = storage.check_variables(&changed).await.unwrap_err();
        assert_eq!(
            error,
            StorageError::TypeMismatch {
                variable: "server.visits".to_owned(),
                stored: "integer",
                declared: word
            }
        );
        let message = error.to_string();
        assert!(message.contains("server.visits"), "{message}");
        assert!(
            message.contains("--reset-variable server.visits"),
            "{message}"
        );
    }
    // Decimal to integer would lose the fraction: also refused.
    let ratio = key(StoredScope::User, "42", "ratio");
    storage.check_variables(&declared()).await.unwrap();
    storage
        .set(&ratio, &StoredValue::Decimal(0.5))
        .await
        .unwrap();
    let mut changed = declared();
    changed[3] = var(
        VariableScope::User,
        "ratio",
        VariableType::Integer,
        json!(0),
    );
    assert!(matches!(
        storage.check_variables(&changed).await,
        Err(StorageError::TypeMismatch { .. })
    ));
    // The refusal changed nothing.
    assert_eq!(get(&storage, &visits).await, Some(StoredValue::Integer(5)));
    assert_eq!(get(&storage, &ratio).await, Some(StoredValue::Decimal(0.5)));
}

#[tokio::test]
async fn a_refusal_is_all_or_nothing() {
    let folder = Folder::new();
    let storage = SqliteStorage::open(&folder.db()).unwrap();
    storage
        .check_variables(&[var(
            VariableScope::Bot,
            "a",
            VariableType::Integer,
            json!(0),
        )])
        .await
        .unwrap();
    storage
        .set(&key(StoredScope::Bot, "", "a"), &StoredValue::Integer(1))
        .await
        .unwrap();
    let both = [
        var(VariableScope::Bot, "b", VariableType::Text, json!("")),
        var(VariableScope::Bot, "a", VariableType::Text, json!("")),
    ];
    assert!(storage.check_variables(&both).await.is_err());
    // `b` came first and was not recorded: a later declaration of it as another type passes.
    storage
        .check_variables(&[var(
            VariableScope::Bot,
            "b",
            VariableType::Boolean,
            json!(false),
        )])
        .await
        .unwrap();
}

#[tokio::test]
async fn a_type_with_nothing_stored_changes_without_a_reset() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let mut changed = declared();
    changed[1] = var(
        VariableScope::Server,
        "visits",
        VariableType::Text,
        json!("none"),
    );
    storage.check_variables(&changed).await.unwrap();
    let visits = key(StoredScope::Server, "100", "visits");
    storage
        .set(&visits, &StoredValue::Text("many".to_owned()))
        .await
        .unwrap();
    assert_eq!(
        get(&storage, &visits).await,
        Some(StoredValue::Text("many".to_owned()))
    );
}

#[tokio::test]
async fn a_variable_that_is_no_longer_declared_keeps_its_values() {
    let folder = Folder::new();
    let visits = key(StoredScope::Server, "100", "visits");
    {
        let storage = folder.open().await;
        storage
            .set(&visits, &StoredValue::Integer(9))
            .await
            .unwrap();
    }
    let storage = SqliteStorage::open(&folder.db()).unwrap();
    storage.check_variables(&declared()[..1]).await.unwrap();
    let again = folder.open().await;
    assert_eq!(get(&again, &visits).await, Some(StoredValue::Integer(9)));
}

#[tokio::test]
async fn reset_variable_deletes_only_that_variable() {
    let folder = Folder::new();
    let storage = folder.open().await;
    let mine = [
        key(StoredScope::Member, "100:42", "warnings"),
        key(StoredScope::Member, "100:43", "warnings"),
    ];
    for owner in &mine {
        storage.set(owner, &StoredValue::Integer(4)).await.unwrap();
    }
    let visits = key(StoredScope::Server, "100", "visits");
    let vip = key(StoredScope::User, "42", "vip");
    storage
        .set(&visits, &StoredValue::Integer(8))
        .await
        .unwrap();
    storage
        .set(&vip, &StoredValue::Boolean(true))
        .await
        .unwrap();

    assert_eq!(
        storage
            .reset_variable(&reference("member.warnings"))
            .await
            .unwrap(),
        2
    );
    assert_eq!(storage.get_many(&mine).await.unwrap(), vec![None, None]);
    assert_eq!(get(&storage, &visits).await, Some(StoredValue::Integer(8)));
    assert_eq!(get(&storage, &vip).await, Some(StoredValue::Boolean(true)));

    // A reset frees the variable to be declared with another type, and a second one is a no-op.
    let mut changed = declared();
    changed[2] = var(
        VariableScope::Member,
        "warnings",
        VariableType::Text,
        json!(""),
    );
    storage.check_variables(&changed).await.unwrap();
    assert_eq!(
        storage
            .reset_variable(&reference("member.warnings"))
            .await
            .unwrap(),
        0
    );
}

#[test]
fn a_variable_is_written_scope_dot_name() {
    for good in ["bot.motto", "server.visits", "member.warnings", "user.vip"] {
        assert_eq!(good.parse::<VarRef>().unwrap().to_string(), good);
    }
    for bad in [
        "motto",
        "run.tmp",
        "guild.visits",
        "bot.",
        "bot.Motto",
        "bot.1a",
        ".a",
        "",
    ] {
        assert!(bad.parse::<VarRef>().is_err(), "{bad:?}");
    }
}

// ---- Migrations -------------------------------------------------------------------------------

fn sample(version: u32) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/samples")
        .join(format!("v{version}.sql"))
}

#[tokio::test]
async fn there_is_a_sample_database_of_every_version_and_it_opens() {
    for version in 1..=current_version() {
        let sql = std::fs::read_to_string(sample(version)).unwrap_or_else(|_| {
            panic!("version {version} of the schema needs tests/samples/v{version}.sql")
        });
        let folder = Folder::new();
        Connection::open(folder.db())
            .unwrap()
            .execute_batch(&sql)
            .unwrap();
        let storage = SqliteStorage::open(&folder.db()).unwrap();
        storage.check_variables(&declared()).await.unwrap();
        let keys = [
            key(StoredScope::Bot, "", "motto"),
            key(StoredScope::Server, "100", "visits"),
            key(StoredScope::Member, "100:42", "warnings"),
            key(StoredScope::User, "42", "ratio"),
            key(StoredScope::User, "42", "vip"),
        ];
        assert_eq!(
            storage.get_many(&keys).await.unwrap(),
            vec![
                Some(StoredValue::Text("hello".to_owned())),
                Some(StoredValue::Integer(7)),
                Some(StoredValue::Integer(2)),
                Some(StoredValue::Decimal(0.5)),
                Some(StoredValue::Boolean(true)),
            ],
            "sample of version {version}"
        );
        drop(storage);
        let version_now: u32 = Connection::open(folder.db())
            .unwrap()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version_now, current_version());
    }
}

fn version_of(path: &Path) -> u32 {
    Connection::open(path)
        .unwrap()
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[tokio::test]
async fn a_new_file_is_created_at_the_current_version_without_a_backup() {
    let folder = Folder::new();
    drop(folder.open().await);
    assert_eq!(version_of(&folder.db()), current_version());
    assert!(folder.names().iter().all(|name| !name.ends_with(".bak")));
}

/// A second version of the schema, as a stand-in for the first real migration.
const NEXT: &str = "ALTER TABLE variable_types ADD COLUMN note TEXT; \
                    UPDATE variables SET value = value + 100 WHERE scope = 'server';";

#[tokio::test]
async fn an_older_database_is_copied_and_then_migrated_in_one_step() {
    let folder = Folder::new();
    let visits = key(StoredScope::Server, "100", "visits");
    {
        let storage = folder.open().await;
        storage
            .set(&visits, &StoredValue::Integer(1))
            .await
            .unwrap();
    }
    let steps = [MIGRATIONS[0], NEXT];
    let storage = SqliteStorage::open_with(&folder.db(), &steps).unwrap();
    assert_eq!(
        get(&storage, &visits).await,
        Some(StoredValue::Integer(101))
    );
    drop(storage);
    assert_eq!(version_of(&folder.db()), 2);

    // The copy is the database as it was: version 1, before the step.
    assert_eq!(folder.names(), ["bot.sqlite", "bot.sqlite.v1.bak"]);
    let backup = folder.dir.path().join("bot.sqlite.v1.bak");
    assert_eq!(version_of(&backup), 1);
    let value: i64 = Connection::open(&backup)
        .unwrap()
        .query_row(
            "SELECT value FROM variables WHERE name = 'visits'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(value, 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&backup).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[tokio::test]
async fn a_backup_is_never_overwritten() {
    let folder = Folder::new();
    drop(folder.open().await);
    std::fs::write(folder.dir.path().join("bot.sqlite.v1.bak"), b"keep me").unwrap();
    drop(SqliteStorage::open_with(&folder.db(), &[MIGRATIONS[0], NEXT]).unwrap());
    assert_eq!(
        std::fs::read(folder.dir.path().join("bot.sqlite.v1.bak")).unwrap(),
        b"keep me"
    );
    assert_eq!(
        version_of(&folder.dir.path().join("bot.sqlite.v1.bak.1")),
        1
    );
}

#[tokio::test]
async fn a_failed_migration_leaves_the_database_as_it_was() {
    let folder = Folder::new();
    let visits = key(StoredScope::Server, "100", "visits");
    {
        let storage = folder.open().await;
        storage
            .set(&visits, &StoredValue::Integer(1))
            .await
            .unwrap();
    }
    // The first statement works and the second does not: nothing of the step may stay.
    let broken = "UPDATE variables SET value = 55; THIS IS NOT SQL;";
    let result = SqliteStorage::open_with(&folder.db(), &[MIGRATIONS[0], broken]);
    assert!(matches!(result, Err(StorageError::Database(_))));
    assert_eq!(version_of(&folder.db()), 1);
    let storage = folder.open().await;
    assert_eq!(get(&storage, &visits).await, Some(StoredValue::Integer(1)));
}

#[tokio::test]
async fn a_newer_database_is_refused_and_left_alone() {
    let folder = Folder::new();
    drop(SqliteStorage::open_with(&folder.db(), &[MIGRATIONS[0], NEXT]).unwrap());
    let error = SqliteStorage::open(&folder.db()).unwrap_err();
    assert_eq!(
        error,
        StorageError::NewerDatabase {
            found: 2,
            supported: 1
        }
    );
    assert!(error.to_string().contains("update the app"));
    assert_eq!(version_of(&folder.db()), 2);
    assert_eq!(folder.names(), ["bot.sqlite"]);
}

#[test]
fn a_database_of_another_program_is_refused() {
    let folder = Folder::new();
    Connection::open(folder.db())
        .unwrap()
        .execute_batch("CREATE TABLE notes (text TEXT);")
        .unwrap();
    let error = SqliteStorage::open(&folder.db()).unwrap_err();
    assert!(matches!(error, StorageError::File(_)), "{error:?}");
    // Nothing of ours was added to it.
    let tables: i64 = Connection::open(folder.db())
        .unwrap()
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
        .unwrap();
    assert_eq!(tables, 1);
}

#[test]
fn a_file_that_is_not_a_database_is_an_error() {
    let folder = Folder::new();
    std::fs::write(
        folder.db(),
        b"this is not a database, but it is long enough to be read",
    )
    .unwrap();
    assert!(matches!(
        SqliteStorage::open(&folder.db()),
        Err(StorageError::Database(_))
    ));
}

#[tokio::test]
async fn the_database_is_in_wal_mode() {
    let folder = Folder::new();
    let storage = folder.open().await;
    // The mode is kept in the file, so a second connection sees it.
    let raw = Connection::open(folder.db()).unwrap();
    let mode: String = raw
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    assert_eq!(mode, "wal");
    drop(storage);
}
