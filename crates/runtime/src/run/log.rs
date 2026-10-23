use std::sync::{Mutex, PoisonError};

/// How serious a log record is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Warn,
    Error,
}

/// One line for the log of the bot. The message names the problem and, where it helps, the flow
/// and the node; it never carries a setting's value, user text or a token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogRecord {
    pub level: Level,
    pub flow: Option<String>,
    pub node: Option<String>,
    pub message: String,
}

/// Where the runtime writes what happens to runs. The runner turns the records into the JSON
/// lines of `docs/ARCHITECTURE.md` §9.2.
pub trait RunLog: Send + Sync + 'static {
    fn record(&self, record: LogRecord);
}

/// A log that keeps its records in memory, for tests.
#[derive(Debug, Default)]
pub struct MemoryLog {
    records: Mutex<Vec<LogRecord>>,
}

impl MemoryLog {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn records(&self) -> Vec<LogRecord> {
        self.records
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl RunLog for MemoryLog {
    fn record(&self, record: LogRecord) {
        self.records
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(record);
    }
}

/// A log that drops every record.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoLog;

impl RunLog for NoLog {
    fn record(&self, _: LogRecord) {}
}
