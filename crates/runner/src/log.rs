//! The log of the runner: JSON lines on standard output (`docs/ARCHITECTURE.md` §9.2).
//!
//! Every line goes through the [`Redactor`], so the token is in none of them, and through the
//! [`RateLimit`], so a flood of events cannot flood the pipe the app reads.

use std::io::Write;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use runtime::run::{Level as RunLevel, LogRecord, RunLog};
use serde_json::{Map, Value, json};

use crate::time::rfc3339;

/// The most lines written in one window.
pub const LINES_PER_WINDOW: u32 = 100;
/// The length of a window.
pub const WINDOW: Duration = Duration::from_secs(1);
/// A message is cut at this many characters.
const MAX_MESSAGE_CHARS: usize = 2000;
const REDACTED: &str = "[redacted]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// Replaces a secret, and the form it takes inside a JSON string, with `[redacted]`.
#[derive(Debug, Clone, Default)]
pub struct Redactor {
    needles: Vec<String>,
}

impl Redactor {
    #[must_use]
    pub fn new(secret: Option<&str>) -> Self {
        let mut needles = Vec::new();
        if let Some(secret) = secret.filter(|secret| !secret.is_empty()) {
            needles.push(secret.to_owned());
            // The secret as it looks once it is inside a JSON string (a quote or a backslash).
            let escaped = json_escaped(secret);
            if escaped != secret {
                needles.push(escaped);
            }
        }
        Self { needles }
    }

    #[must_use]
    pub fn apply(&self, text: &str) -> String {
        let mut text = text.to_owned();
        for needle in &self.needles {
            if text.contains(needle.as_str()) {
                text = text.replace(needle.as_str(), REDACTED);
            }
        }
        text
    }

    fn apply_to_value(&self, value: Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.apply(&text)),
            Value::Array(items) => {
                Value::Array(items.into_iter().map(|v| self.apply_to_value(v)).collect())
            }
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .map(|(key, v)| (self.apply(&key), self.apply_to_value(v)))
                    .collect(),
            ),
            other => other,
        }
    }
}

/// `text` as it is written between the quotes of a JSON string.
fn json_escaped(text: &str) -> String {
    let quoted = Value::String(text.to_owned()).to_string();
    quoted
        .get(1..quoted.len().saturating_sub(1))
        .unwrap_or_default()
        .to_owned()
}

/// Lets `LINES_PER_WINDOW` lines through in each `WINDOW` and counts the rest.
#[derive(Debug)]
pub struct RateLimit {
    window_start: Instant,
    written: u32,
    dropped: u64,
}

/// What to do with a line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// Write it, after a line that says this many were dropped (when there are some).
    Write {
        dropped_before: u64,
    },
    Drop,
}

impl RateLimit {
    #[must_use]
    pub const fn new(now: Instant) -> Self {
        Self {
            window_start: now,
            written: 0,
            dropped: 0,
        }
    }

    pub fn admit(&mut self, now: Instant) -> Admission {
        if now.saturating_duration_since(self.window_start) >= WINDOW {
            self.window_start = now;
            self.written = 0;
        }
        if self.written == 0 && self.dropped > 0 {
            // The line that reports the drops takes the first place of the window.
            let dropped_before = std::mem::take(&mut self.dropped);
            self.written = 2;
            return Admission::Write { dropped_before };
        }
        if self.written >= LINES_PER_WINDOW {
            self.dropped = self.dropped.saturating_add(1);
            return Admission::Drop;
        }
        self.written += 1;
        Admission::Write { dropped_before: 0 }
    }

    /// How many lines were dropped and not yet reported.
    pub fn take_dropped(&mut self) -> u64 {
        std::mem::take(&mut self.dropped)
    }
}

/// One line before it is written.
#[derive(Debug, Clone, Default)]
pub struct Line {
    pub run: Option<u64>,
    pub flow: Option<String>,
    pub node: Option<String>,
    pub fields: Map<String, Value>,
}

struct State<W> {
    out: W,
    limit: RateLimit,
}

/// Writes the lines. It is shared by the runner and by the runtime, which sees it as a
/// [`RunLog`].
pub struct JsonLog<W: Write + Send + 'static> {
    state: Mutex<State<W>>,
    redactor: Redactor,
    clock: fn() -> SystemTime,
    ticks: fn() -> Instant,
}

impl<W: Write + Send + 'static> JsonLog<W> {
    #[must_use]
    pub fn new(out: W, redactor: Redactor) -> Self {
        Self::with_clocks(out, redactor, SystemTime::now, Instant::now)
    }

    /// Like [`new`](Self::new), with the time stamp and the rate limit reading the clocks given.
    #[must_use]
    pub fn with_clocks(
        out: W,
        redactor: Redactor,
        clock: fn() -> SystemTime,
        ticks: fn() -> Instant,
    ) -> Self {
        Self {
            state: Mutex::new(State {
                out,
                limit: RateLimit::new(ticks()),
            }),
            redactor,
            clock,
            ticks,
        }
    }

    /// Writes a line from the runner itself (`source` is `engine`).
    pub fn engine(&self, level: Level, message: &str, line: Line) {
        self.write(level, "engine", message, line);
    }

    pub fn info(&self, message: &str) {
        self.engine(Level::Info, message, Line::default());
    }

    pub fn warn(&self, message: &str) {
        self.engine(Level::Warn, message, Line::default());
    }

    /// Writes the line that says how many lines were dropped, if some were. Call it before
    /// the process ends.
    pub fn finish(&self) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let dropped = state.limit.take_dropped();
        if dropped > 0 {
            let text = self.render(
                Level::Warn,
                "engine",
                &dropped_message(dropped),
                Line::default(),
            );
            Self::put(&mut state.out, &text);
        }
    }

    fn write(&self, level: Level, source: &str, message: &str, line: Line) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        match state.limit.admit((self.ticks)()) {
            Admission::Drop => {}
            Admission::Write { dropped_before } => {
                if dropped_before > 0 {
                    let note = self.render(
                        Level::Warn,
                        "engine",
                        &dropped_message(dropped_before),
                        Line::default(),
                    );
                    Self::put(&mut state.out, &note);
                }
                let text = self.render(level, source, message, line);
                Self::put(&mut state.out, &text);
            }
        }
    }

    fn render(&self, level: Level, source: &str, message: &str, line: Line) -> String {
        let message: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
        let object = json!({
            "ts": rfc3339((self.clock)()),
            "level": level.as_str(),
            "source": source,
            "run": line.run.map(|run| format!("r{run}")),
            "flow": line.flow,
            "node": line.node,
            "msg": message,
            "fields": Value::Object(line.fields),
        });
        // Redact the values, then the finished text, so no form of the secret gets through.
        let text = self.redactor.apply_to_value(object).to_string();
        self.redactor.apply(&text)
    }

    fn put(out: &mut W, text: &str) {
        // One write per line, so lines of two writers never mix. A closed pipe has nobody to tell.
        let mut line = String::with_capacity(text.len() + 1);
        line.push_str(text);
        line.push('\n');
        let _ = out.write_all(line.as_bytes());
        let _ = out.flush();
    }
}

fn dropped_message(count: u64) -> String {
    format!("{count} log lines were dropped because the log rate limit was passed")
}

impl<W: Write + Send + 'static> RunLog for JsonLog<W> {
    fn record(&self, record: LogRecord) {
        let level = match record.level {
            RunLevel::Warn => Level::Warn,
            RunLevel::Error => Level::Error,
        };
        self.engine(
            level,
            &record.message,
            Line {
                run: record.run,
                flow: record.flow,
                node: record.node,
                fields: Map::new(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    /// A writer the test can read back.
    #[derive(Clone, Default)]
    struct Sink(Arc<Mutex<Vec<u8>>>);

    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Sink {
        fn lines(&self) -> Vec<Value> {
            String::from_utf8(self.0.lock().unwrap().clone())
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }

        fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    fn log(secret: Option<&str>) -> (JsonLog<Sink>, Sink) {
        let sink = Sink::default();
        (JsonLog::new(sink.clone(), Redactor::new(secret)), sink)
    }

    /// A clock that does not move, so a test never straddles two windows.
    fn frozen() -> Instant {
        static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
        *START.get_or_init(Instant::now)
    }

    #[test]
    fn a_line_has_the_documented_fields() {
        let (log, sink) = log(None);
        log.record(LogRecord {
            level: RunLevel::Error,
            run: Some(7),
            flow: Some("ping".to_owned()),
            node: Some("reply".to_owned()),
            message: "it failed".to_owned(),
        });
        log.info("started");
        let lines = sink.lines();
        assert_eq!(lines.len(), 2);
        let first = &lines[0];
        assert_eq!(first["level"], "error");
        assert_eq!(first["source"], "engine");
        assert_eq!(first["run"], "r7");
        assert_eq!(first["flow"], "ping");
        assert_eq!(first["node"], "reply");
        assert_eq!(first["msg"], "it failed");
        assert_eq!(first["fields"], json!({}));
        assert!(first["ts"].as_str().unwrap().ends_with('Z'));
        let second = &lines[1];
        assert_eq!(second["level"], "info");
        assert!(second["run"].is_null());
        assert!(second["flow"].is_null());
        assert!(second["node"].is_null());
    }

    #[test]
    fn the_secret_is_in_no_field_and_in_no_form() {
        let secret = "ab\"c\\d.secret-token";
        let (log, sink) = log(Some(secret));
        log.record(LogRecord {
            level: RunLevel::Warn,
            run: Some(1),
            flow: Some(format!("flow-{secret}")),
            node: Some(secret.to_owned()),
            message: format!("failed with {secret} and again {secret}"),
        });
        let mut fields = Map::new();
        fields.insert("list".to_owned(), json!([secret, {"deep": secret}]));
        fields.insert(secret.to_owned(), json!(1));
        log.engine(
            Level::Info,
            "fields",
            Line {
                fields,
                ..Line::default()
            },
        );
        let text = sink.text();
        assert!(!text.contains("secret-token"), "{text}");
        assert!(text.contains(REDACTED));
        for line in sink.lines() {
            assert!(!line.to_string().contains("secret-token"));
        }
    }

    #[test]
    fn an_empty_secret_redacts_nothing() {
        let redactor = Redactor::new(Some(""));
        assert_eq!(redactor.apply("hello"), "hello");
        assert_eq!(Redactor::new(None).apply("hello"), "hello");
    }

    #[test]
    fn a_long_message_is_cut() {
        let (log, sink) = log(None);
        log.info(&"é".repeat(MAX_MESSAGE_CHARS + 500));
        let msg = sink.lines()[0]["msg"].as_str().unwrap().to_owned();
        assert_eq!(msg.chars().count(), MAX_MESSAGE_CHARS);
    }

    #[test]
    fn the_rate_limit_drops_and_reports_in_the_next_window() {
        let start = Instant::now();
        let mut limit = RateLimit::new(start);
        for _ in 0..LINES_PER_WINDOW {
            assert_eq!(limit.admit(start), Admission::Write { dropped_before: 0 });
        }
        for _ in 0..25 {
            assert_eq!(
                limit.admit(start + Duration::from_millis(900)),
                Admission::Drop
            );
        }
        // A new window: the report comes first, and takes a place of the window.
        let later = start + WINDOW;
        assert_eq!(limit.admit(later), Admission::Write { dropped_before: 25 });
        for _ in 0..(LINES_PER_WINDOW - 2) {
            assert_eq!(limit.admit(later), Admission::Write { dropped_before: 0 });
        }
        assert_eq!(limit.admit(later), Admission::Drop);
        assert_eq!(limit.take_dropped(), 1);
        assert_eq!(limit.take_dropped(), 0);
    }

    #[test]
    fn a_flood_writes_a_bounded_number_of_lines_and_says_how_many_were_lost() {
        let sink = Sink::default();
        let log = JsonLog::with_clocks(sink.clone(), Redactor::default(), SystemTime::now, frozen);
        for n in 0..1000 {
            log.info(&format!("line {n}"));
        }
        assert_eq!(
            sink.lines().len(),
            usize::try_from(LINES_PER_WINDOW).unwrap()
        );
        log.finish();
        let lines = sink.lines();
        let last = lines.last().unwrap();
        assert_eq!(last["level"], "warn");
        assert!(
            last["msg"]
                .as_str()
                .unwrap()
                .starts_with("900 log lines were dropped")
        );
        let before = lines.len();
        log.finish();
        assert_eq!(sink.lines().len(), before);
    }
}
