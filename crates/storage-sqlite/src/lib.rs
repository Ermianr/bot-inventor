//! The `Storage` implementation on SQLite (`docs/ARCHITECTURE.md` §8).
//!
//! `rusqlite` is synchronous, so one connection lives on its own thread and every operation is a
//! job sent to it. That serializes the writes, keeps the memory of one connection, and keeps
//! blocking calls off the async runtime. The jobs never wait for each other, and a run waits for
//! the answer to one at a time, so the queue is never longer than the number of runs.

mod file;
mod ops;
mod schema;

use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, Sender};
use std::thread::JoinHandle;

use runtime::graph::Variable;
use runtime::storage::{Storage, StorageError, StoredValue, VarKey, VarRef};
use rusqlite::Connection;
use tokio::sync::oneshot;

pub use schema::{MIGRATIONS, current_version};

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

/// The database of a bot. A clone is another handle to the same connection.
#[derive(Debug, Clone)]
pub struct SqliteStorage {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    jobs: Option<Sender<Job>>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Inner {
    /// Closes the connection: the thread ends when its last job is done, and the database is
    /// closed, with its write-ahead log folded in, before this returns.
    fn drop(&mut self) {
        drop(self.jobs.take());
        if let Some(thread) = self.thread.take() {
            // A panic of the thread has nothing left to report.
            let _ = thread.join();
        }
    }
}

impl SqliteStorage {
    /// Opens the database at `path`, creating it (mode 0600) if it is not there, and migrates it
    /// to the current version. It blocks, so call it before the first run or on a blocking
    /// thread.
    ///
    /// # Errors
    ///
    /// [`StorageError::NewerDatabase`] for a database written by a newer app,
    /// [`StorageError::File`] for a path that cannot be used, [`StorageError::Database`] for
    /// the rest.
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        Self::open_with(path, MIGRATIONS)
    }

    /// Like [`open`](Self::open), with the steps of the migration given: `steps[n]` takes
    /// version `n` to `n + 1`. It is how the migration machinery is tested before a second
    /// version of the schema exists.
    ///
    /// # Errors
    ///
    /// As [`open`](Self::open).
    pub fn open_with(path: &Path, steps: &[&str]) -> Result<Self, StorageError> {
        let conn = file::connect(path, steps)?;
        let (jobs, queue) = mpsc::channel::<Job>();
        let thread = std::thread::Builder::new()
            .name("bot-inventor-storage".to_owned())
            .spawn(move || {
                let mut conn = conn;
                while let Ok(job) = queue.recv() {
                    job(&mut conn);
                }
            })
            .map_err(|_| StorageError::Database("the storage thread could not start".to_owned()))?;
        Ok(Self {
            inner: Arc::new(Inner {
                jobs: Some(jobs),
                thread: Some(thread),
            }),
        })
    }

    /// Runs `work` on the connection and waits for its result.
    async fn call<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, StorageError> + Send + 'static,
    ) -> Result<T, StorageError> {
        let (reply, answer) = oneshot::channel();
        let jobs = self.inner.jobs.as_ref().ok_or(StorageError::Closed)?;
        jobs.send(Box::new(move |conn| {
            // The caller may have given up waiting; the work is done either way.
            let _ = reply.send(work(conn));
        }))
        .map_err(|_| StorageError::Closed)?;
        answer.await.map_err(|_| StorageError::Closed)?
    }
}

impl Storage for SqliteStorage {
    async fn check_variables(&self, declared: &[Variable]) -> Result<(), StorageError> {
        let declared = ops::declarations(declared);
        self.call(move |conn| ops::check_variables(conn, &declared))
            .await
    }

    async fn get_many(&self, keys: &[VarKey]) -> Result<Vec<Option<StoredValue>>, StorageError> {
        let keys = keys.to_vec();
        self.call(move |conn| ops::get_many(conn, &keys)).await
    }

    async fn set(&self, key: &VarKey, value: &StoredValue) -> Result<(), StorageError> {
        let (key, value) = (key.clone(), value.clone());
        self.call(move |conn| ops::set(conn, &key, &value)).await
    }

    async fn add(
        &self,
        key: &VarKey,
        initial: &StoredValue,
        delta: &StoredValue,
    ) -> Result<StoredValue, StorageError> {
        let (key, initial, delta) = (key.clone(), initial.clone(), delta.clone());
        self.call(move |conn| ops::add(conn, &key, &initial, &delta))
            .await
    }

    async fn reset_variable(&self, variable: &VarRef) -> Result<u64, StorageError> {
        let variable = variable.clone();
        self.call(move |conn| ops::reset_variable(conn, &variable))
            .await
    }
}
