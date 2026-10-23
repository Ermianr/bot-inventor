//! Opening the database file: its permissions, its pragmas, its version and its backups.

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use runtime::storage::StorageError;
use rusqlite::{Connection, OpenFlags, TransactionBehavior};

use crate::ops::db;

/// How long a statement waits for a lock another connection holds.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The page cache, in KiB: small, because the data is small.
const CACHE_KIB: i64 = 1024;

fn file_error(what: &str, error: &io::Error) -> StorageError {
    StorageError::File(format!("{what}: {}", error.kind()))
}

/// Creates the file with mode 0600 if it is not there, and refuses what is not a regular file.
fn prepare(path: &Path) -> Result<(), StorageError> {
    match create_private(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let meta = fs::symlink_metadata(path).map_err(|e| file_error("cannot read it", &e))?;
            if meta.is_file() {
                Ok(())
            } else {
                Err(StorageError::File(
                    "it is not a regular file (a link or a folder is refused)".to_owned(),
                ))
            }
        }
        Err(error) => Err(file_error("cannot create it", &error)),
    }
}

/// Creates a new, empty file that only its owner can read.
fn create_private(path: &Path) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map(drop)
}

/// Opens `path`, creating it if needed, and brings its schema up to the last of `steps`.
pub fn connect(path: &Path, steps: &[&str]) -> Result<Connection, StorageError> {
    prepare(path)?;
    // No `URI` flag: the path is a path, whatever it looks like.
    let mut conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(db)?;
    conn.busy_timeout(BUSY_TIMEOUT).map_err(db)?;
    let mode: String = conn
        .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get(0))
        .map_err(db)?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err(StorageError::File(
            "the file system does not support the write-ahead log".to_owned(),
        ));
    }
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(db)?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(db)?;
    conn.pragma_update(None, "trusted_schema", "OFF")
        .map_err(db)?;
    conn.pragma_update(None, "cache_size", -CACHE_KIB)
        .map_err(db)?;
    migrate(&mut conn, path, steps)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection, path: &Path, steps: &[&str]) -> Result<(), StorageError> {
    let supported = u32::try_from(steps.len()).unwrap_or(u32::MAX);
    let found: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(db)?;
    if found > supported {
        return Err(StorageError::NewerDatabase { found, supported });
    }
    if found == supported {
        return Ok(());
    }
    if found == 0 {
        let tables: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
            .map_err(db)?;
        if tables != 0 {
            return Err(StorageError::File(
                "it is a database, but not one of Bot Inventor".to_owned(),
            ));
        }
    } else {
        backup(conn, path, found)?;
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    for (index, sql) in steps.iter().enumerate().skip(found as usize) {
        tx.execute_batch(sql).map_err(db)?;
        let version = u32::try_from(index + 1).unwrap_or(u32::MAX);
        tx.pragma_update(None, "user_version", version)
            .map_err(db)?;
    }
    tx.commit().map_err(db)
}

/// A consistent copy of the database before a migration, next to it, that nothing overwrites:
/// `bot.sqlite.v1.bak`, then `bot.sqlite.v1.bak.1` and so on.
fn backup(conn: &Connection, path: &Path, version: u32) -> Result<(), StorageError> {
    let mut name: OsString = path.as_os_str().to_owned();
    name.push(format!(".v{version}.bak"));
    let first = PathBuf::from(name);
    for attempt in 0..100 {
        let mut candidate = first.clone().into_os_string();
        if attempt > 0 {
            candidate.push(format!(".{attempt}"));
        }
        let candidate = PathBuf::from(candidate);
        match create_private(&candidate) {
            Ok(()) => {
                let target = candidate.to_str().ok_or_else(|| {
                    StorageError::File("the path of the backup is not valid text".to_owned())
                })?;
                // `VACUUM INTO` copies a consistent snapshot, the write-ahead log included.
                return match conn.execute("VACUUM INTO ?1", [target]) {
                    Ok(_) => Ok(()),
                    Err(error) => {
                        let _ = fs::remove_file(&candidate);
                        Err(db(error))
                    }
                };
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(file_error("cannot create the backup", &error)),
        }
    }
    Err(StorageError::File(
        "there are too many backups next to the database".to_owned(),
    ))
}
