//! Runs the runner as a child process and turns what it prints into events for the interface
//! (`docs/ARCHITECTURE.md` §9.1).
//!
//! The child gets a cleared environment and only the variables it is given; it is stopped with
//! `SIGTERM` and killed after a grace period. One bot runs at a time. Nothing here knows Tauri:
//! the events go to a callback, so the tests use a stand-in executable.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use specta::Type;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::time::{Instant, Sleep, sleep};

/// The longest line read from the child; the rest of a longer line is dropped.
pub const MAX_LINE_BYTES: usize = 64 * 1024;
/// How long a stopped bot has to finish its runs (the runner waits 5 seconds) before the kill.
pub const STOP_GRACE: Duration = Duration::from_secs(10);
/// How long the output of a child that has exited is read for.
const DRAIN: Duration = Duration::from_secs(1);
/// A message is cut at this many characters, as in the runner.
const MAX_MESSAGE_CHARS: usize = 2000;
/// The other text fields of a line are cut at this many.
const MAX_FIELD_CHARS: usize = 128;

/// How the TypeScript types describe a JSON value in `fields`: `serde_json::Value` holds 64-bit
/// integers, which `specta` refuses. It is only a stand-in for `specta(type = ...)`.
#[derive(Serialize, Type)]
#[serde(untagged)]
#[allow(dead_code)]
pub enum FieldValue {
    Null,
    Bool(bool),
    Number(i32),
    Text(String),
    List(Vec<FieldValue>),
    Object(BTreeMap<String, FieldValue>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// One line of the bot's log, as the runner writes it (`docs/ARCHITECTURE.md` §9.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct LogLine {
    /// RFC 3339 in UTC; `None` for a line the app made itself.
    pub ts: Option<String>,
    pub level: LogLevel,
    /// `engine` or `bot`.
    pub source: String,
    pub run: Option<String>,
    pub flow: Option<String>,
    pub node: Option<String>,
    pub msg: String,
    #[serde(default)]
    #[specta(type = BTreeMap<String, FieldValue>)]
    pub fields: Map<String, Value>,
}

impl LogLine {
    /// A line the app writes, as `engine`.
    fn engine(level: LogLevel, msg: &str) -> Self {
        Self {
            ts: None,
            level,
            source: "engine".to_owned(),
            run: None,
            flow: None,
            node: None,
            msg: cut(msg, MAX_MESSAGE_CHARS),
            fields: Map::new(),
        }
    }

    /// Cuts every text to its limit, whatever the child sent.
    fn limited(mut self) -> Self {
        self.ts = self.ts.map(|v| cut(&v, MAX_FIELD_CHARS));
        self.source = cut(&self.source, MAX_FIELD_CHARS);
        self.run = self.run.map(|v| cut(&v, MAX_FIELD_CHARS));
        self.flow = self.flow.map(|v| cut(&v, MAX_FIELD_CHARS));
        self.node = self.node.map(|v| cut(&v, MAX_FIELD_CHARS));
        self.msg = cut(&self.msg, MAX_MESSAGE_CHARS);
        self
    }
}

fn cut(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

/// Why the child stopped, from its exit code (`docs/ARCHITECTURE.md` §9.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ExitReason {
    Clean,
    Failure,
    Configuration,
    PayloadVersion,
    /// Ended by a signal, which the person asked for if `requested` is set.
    Signal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RunStatus {
    Starting,
    /// The runner has printed its first line.
    Running,
    Stopping,
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
        reason: ExitReason,
        /// The person asked to stop; otherwise the exit was unexpected.
        requested: bool,
    },
}

/// What the interface receives, in order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum RunEvent {
    Log(LogLine),
    Status(RunStatus),
}

pub type Emit = Arc<dyn Fn(RunEvent) + Send + Sync>;

/// What to start.
#[derive(Debug, Clone)]
pub struct Spec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    /// The whole environment of the child.
    pub env: Vec<(OsString, OsString)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartError {
    AlreadyRunning,
    /// The program could not be started; the kind of failure only.
    Spawn(io::ErrorKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StopResult {
    NotRunning,
    Stopped,
}

struct Active {
    id: u64,
    stop: mpsc::UnboundedSender<()>,
    done: watch::Receiver<bool>,
}

/// Runs one child at a time.
#[derive(Clone)]
pub struct Supervisor {
    active: Arc<Mutex<Option<Active>>>,
    next_id: Arc<AtomicU64>,
    grace: Duration,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::with_grace(STOP_GRACE)
    }
}

impl Supervisor {
    #[must_use]
    pub fn with_grace(grace: Duration) -> Self {
        Self {
            active: Arc::default(),
            next_id: Arc::default(),
            grace,
        }
    }

    /// Starts the child. It must be called inside a tokio runtime.
    ///
    /// # Errors
    ///
    /// [`StartError::AlreadyRunning`] while a child runs, [`StartError::Spawn`] when the
    /// program cannot be started.
    pub fn start(&self, spec: &Spec, emit: Emit) -> Result<(), StartError> {
        let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        if active.is_some() {
            return Err(StartError::AlreadyRunning);
        }
        let mut child = Command::new(&spec.program)
            .args(&spec.args)
            .env_clear()
            .envs(spec.env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // A last resort: the child does not outlive the app if the supervisor is dropped.
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| StartError::Spawn(error.kind()))?;
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            return Err(StartError::Spawn(io::ErrorKind::BrokenPipe));
        };

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (stop, stop_rx) = mpsc::unbounded_channel();
        let (done_tx, done) = watch::channel(false);
        *active = Some(Active { id, stop, done });
        drop(active);

        emit(RunEvent::Status(RunStatus::Starting));
        let table = Arc::clone(&self.active);
        let grace = self.grace;
        tokio::spawn(async move {
            let exited = supervise(child, stdout, stderr, stop_rx, grace, &emit).await;
            // Free the slot first, so a start that follows the event is accepted.
            {
                let mut active = table.lock().unwrap_or_else(PoisonError::into_inner);
                if active.as_ref().is_some_and(|a| a.id == id) {
                    *active = None;
                }
            }
            emit(RunEvent::Status(exited));
            let _ = done_tx.send(true);
        });
        Ok(())
    }

    /// Asks the child to stop and waits until it has: `SIGTERM`, then a kill after the grace
    /// period.
    pub async fn stop(&self) -> StopResult {
        let handle = self
            .active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|a| (a.stop.clone(), a.done.clone()));
        let Some((stop, mut done)) = handle else {
            return StopResult::NotRunning;
        };
        let _ = stop.send(());
        let _ = done.wait_for(|finished| *finished).await;
        StopResult::Stopped
    }

    #[must_use]
    pub fn is_running(&self) -> bool {
        self.active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }
}

/// Reads lines of at most [`MAX_LINE_BYTES`], so a child cannot make the app keep a huge line.
struct LineReader<R> {
    inner: BufReader<R>,
    line: Vec<u8>,
    truncated: bool,
}

struct Line {
    text: String,
    truncated: bool,
}

impl<R: AsyncRead + Unpin> LineReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner: BufReader::new(inner),
            line: Vec::new(),
            truncated: false,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        let room = MAX_LINE_BYTES - self.line.len();
        self.line.extend_from_slice(&bytes[..bytes.len().min(room)]);
        self.truncated |= bytes.len() > room;
    }

    fn take(&mut self) -> Line {
        let mut text = String::from_utf8_lossy(&self.line).into_owned();
        if text.ends_with('\r') {
            text.pop();
        }
        let truncated = std::mem::take(&mut self.truncated);
        self.line.clear();
        Line { text, truncated }
    }

    /// The next line; a last line with no line break is returned too. Cancel safe.
    async fn next(&mut self) -> io::Result<Option<Line>> {
        loop {
            let available = self.inner.fill_buf().await?;
            if available.is_empty() {
                return Ok((!self.line.is_empty() || self.truncated).then(|| self.take()));
            }
            if let Some(end) = available.iter().position(|&b| b == b'\n') {
                let bytes = available[..end].to_vec();
                self.inner.consume(end + 1);
                self.push(&bytes);
                return Ok(Some(self.take()));
            }
            let bytes = available.to_vec();
            self.inner.consume(bytes.len());
            self.push(&bytes);
        }
    }
}

/// A line of standard output: a log record if it is one, otherwise a warning with its text.
fn stdout_line(line: &Line) -> Option<LogLine> {
    if line.text.trim().is_empty() {
        return None;
    }
    if !line.truncated
        && let Ok(record) = serde_json::from_str::<LogLine>(&line.text)
    {
        return Some(record.limited());
    }
    Some(LogLine::engine(LogLevel::Warn, &line.text))
}

/// A line of standard error, where the runner writes why it could not start.
fn stderr_line(line: &Line) -> Option<LogLine> {
    (!line.text.trim().is_empty()).then(|| LogLine::engine(LogLevel::Error, &line.text))
}

fn exit_status(status: Option<io::Result<ExitStatus>>, requested: bool) -> RunStatus {
    use std::os::unix::process::ExitStatusExt;
    let Some(Ok(status)) = status else {
        return RunStatus::Exited {
            code: None,
            signal: None,
            reason: ExitReason::Failure,
            requested,
        };
    };
    let reason = match (status.code(), status.signal()) {
        (Some(0), _) => ExitReason::Clean,
        (Some(2), _) => ExitReason::Configuration,
        (Some(3), _) => ExitReason::PayloadVersion,
        (Some(_), _) => ExitReason::Failure,
        (None, Some(_)) => ExitReason::Signal,
        (None, None) => ExitReason::Failure,
    };
    RunStatus::Exited {
        code: status.code(),
        signal: status.signal(),
        reason,
        requested,
    }
}

fn terminate(child: &Child) {
    let pid = child
        .id()
        .and_then(|id| i32::try_from(id).ok())
        .and_then(rustix::process::Pid::from_raw);
    if let Some(pid) = pid {
        // The child may have just exited; there is nothing to do about that.
        let _ = rustix::process::kill_process(pid, rustix::process::Signal::TERM);
    }
}

async fn wait_for(timer: &mut Option<Pin<Box<Sleep>>>) {
    match timer {
        Some(sleep) => sleep.as_mut().await,
        None => std::future::pending().await,
    }
}

/// Reads the child until it has exited and its output has ended, then reports how it exited.
async fn supervise(
    mut child: Child,
    stdout: impl AsyncRead + Unpin,
    stderr: impl AsyncRead + Unpin,
    mut stop: mpsc::UnboundedReceiver<()>,
    grace: Duration,
    emit: &Emit,
) -> RunStatus {
    let mut out = LineReader::new(stdout);
    let mut err = LineReader::new(stderr);
    let (mut out_open, mut err_open) = (true, true);
    let mut status = None;
    let mut running = false;
    let mut requested = false;
    let mut kill_timer: Option<Pin<Box<Sleep>>> = None;
    let mut drain_timer: Option<Pin<Box<Sleep>>> = None;

    while status.is_none() || out_open || err_open {
        tokio::select! {
            line = out.next(), if out_open => match line {
                Ok(Some(line)) => {
                    if let Some(log) = stdout_line(&line) {
                        if !std::mem::replace(&mut running, true) {
                            emit(RunEvent::Status(RunStatus::Running));
                        }
                        emit(RunEvent::Log(log));
                    }
                }
                Ok(None) | Err(_) => out_open = false,
            },
            line = err.next(), if err_open => match line {
                Ok(Some(line)) => {
                    if let Some(log) = stderr_line(&line) {
                        emit(RunEvent::Log(log));
                    }
                }
                Ok(None) | Err(_) => err_open = false,
            },
            result = child.wait(), if status.is_none() => {
                status = Some(result);
                kill_timer = None;
                drain_timer = Some(Box::pin(sleep(DRAIN)));
            },
            Some(()) = stop.recv(), if !requested && status.is_none() => {
                requested = true;
                emit(RunEvent::Status(RunStatus::Stopping));
                terminate(&child);
                kill_timer = Some(Box::pin(tokio::time::sleep_until(Instant::now() + grace)));
            },
            () = wait_for(&mut kill_timer), if kill_timer.is_some() => {
                kill_timer = None;
                let _ = child.start_kill();
            },
            () = wait_for(&mut drain_timer), if drain_timer.is_some() => {
                // Something else holds the pipes open: stop reading.
                break;
            },
        }
    }
    exit_status(status, requested)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use tokio::sync::mpsc::UnboundedReceiver;
    use tokio::time::timeout;

    use super::*;

    const WAIT: Duration = Duration::from_secs(20);

    /// A stand-in for the runner: a shell script.
    fn script(dir: &Path, body: &str) -> Spec {
        let path = dir.join("standin");
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("a script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("a mode");
        Spec {
            program: path,
            args: Vec::new(),
            env: vec![("MARKER".into(), "yes".into())],
        }
    }

    fn collector() -> (Emit, UnboundedReceiver<RunEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let emit: Emit = Arc::new(move |event| {
            let _ = tx.send(event);
        });
        (emit, rx)
    }

    /// Every event up to and including the exit.
    async fn until_exit(rx: &mut UnboundedReceiver<RunEvent>) -> Vec<RunEvent> {
        let mut events = Vec::new();
        loop {
            let event = timeout(WAIT, rx.recv())
                .await
                .expect("the child exits in time")
                .expect("the channel is open");
            let done = matches!(event, RunEvent::Status(RunStatus::Exited { .. }));
            events.push(event);
            if done {
                return events;
            }
        }
    }

    /// Waits for the first line of output, so a trap in the script is in place.
    async fn until_running(rx: &mut UnboundedReceiver<RunEvent>) {
        loop {
            let event = timeout(WAIT, rx.recv())
                .await
                .expect("the child prints in time")
                .expect("the channel is open");
            if event == RunEvent::Status(RunStatus::Running) {
                return;
            }
        }
    }

    fn messages(events: &[RunEvent]) -> Vec<&str> {
        events
            .iter()
            .filter_map(|event| match event {
                RunEvent::Log(line) => Some(line.msg.as_str()),
                RunEvent::Status(_) => None,
            })
            .collect()
    }

    fn exited(events: &[RunEvent]) -> &RunStatus {
        match events.last() {
            Some(RunEvent::Status(status @ RunStatus::Exited { .. })) => status,
            other => panic!("the last event is not an exit: {other:?}"),
        }
    }

    fn record(msg: &str) -> String {
        format!(
            r#"{{"ts":"2026-10-24T10:00:00.000Z","level":"info","source":"engine","run":"r1","flow":"ping","node":"reply","msg":"{msg}","fields":{{}}}}"#
        )
    }

    #[tokio::test]
    async fn the_child_gets_a_cleared_environment_and_only_what_it_is_given() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        // This process has a PATH and a HOME; the child must not.
        assert!(std::env::var_os("PATH").is_some());
        let mut spec = script(dir.path(), "env; echo \"args=$#\"");
        spec.args = vec!["--one".into()];
        Supervisor::default().start(&spec, emit).expect("it starts");
        let events = until_exit(&mut rx).await;
        let lines = messages(&events);
        assert!(lines.contains(&"MARKER=yes"), "{lines:?}");
        assert!(lines.contains(&"args=1"), "{lines:?}");
        for line in lines {
            let key = line.split('=').next().unwrap_or_default();
            assert!(
                matches!(key, "MARKER" | "args" | "PWD" | "SHLVL" | "_" | "OLDPWD"),
                "an unexpected variable: {line}"
            );
        }
    }

    #[tokio::test]
    async fn lines_arrive_in_order_between_starting_and_the_exit() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        let line = record("%s");
        let spec = script(
            dir.path(),
            &format!("i=0\nwhile [ $i -lt 10000 ]; do printf '{line}\\n' $i; i=$((i+1)); done"),
        );
        Supervisor::default().start(&spec, emit).expect("it starts");
        let events = until_exit(&mut rx).await;

        assert_eq!(events[0], RunEvent::Status(RunStatus::Starting));
        assert_eq!(events[1], RunEvent::Status(RunStatus::Running));
        let expected: Vec<String> = (0..10_000).map(|i| i.to_string()).collect();
        assert_eq!(messages(&events), expected);
        assert_eq!(
            exited(&events),
            &RunStatus::Exited {
                code: Some(0),
                signal: None,
                reason: ExitReason::Clean,
                requested: false
            }
        );
        let RunEvent::Log(first) = &events[2] else {
            panic!("a log line")
        };
        assert_eq!(first.ts.as_deref(), Some("2026-10-24T10:00:00.000Z"));
        assert_eq!(first.run.as_deref(), Some("r1"));
        assert_eq!(first.flow.as_deref(), Some("ping"));
        assert_eq!(first.level, LogLevel::Info);
    }

    #[tokio::test]
    async fn odd_output_becomes_warnings_and_never_a_failure() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        let spec = script(
            dir.path(),
            r#"printf '\377\376 bad bytes\n'
printf 'not json\n'
printf '{"msg": 1}\n'
printf '\n\n'
head -c 200000 /dev/zero | tr '\0' a
echo
printf 'after the huge line\n'
printf 'no line break at the end'"#,
        );
        Supervisor::default().start(&spec, emit).expect("it starts");
        let events = until_exit(&mut rx).await;
        let lines = messages(&events);
        assert_eq!(lines.len(), 6, "{lines:?}");
        assert!(lines[0].contains("bad bytes"));
        assert_eq!(lines[1], "not json");
        assert_eq!(lines[2], r#"{"msg": 1}"#);
        assert_eq!(lines[3].chars().count(), MAX_MESSAGE_CHARS);
        assert_eq!(lines[4], "after the huge line");
        assert_eq!(lines[5], "no line break at the end");
        for event in &events {
            if let RunEvent::Log(line) = event {
                assert_eq!(line.level, LogLevel::Warn);
                assert_eq!(line.source, "engine");
            }
        }
    }

    #[tokio::test]
    async fn the_text_of_a_record_is_cut() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        let long = "b".repeat(5000);
        let spec = script(
            dir.path(),
            &format!(
                r#"echo '{{"ts":"t","level":"error","source":"{long}","run":null,"flow":"{long}","node":null,"msg":"{long}","fields":{{"n":1}}}}'"#
            ),
        );
        Supervisor::default().start(&spec, emit).expect("it starts");
        let events = until_exit(&mut rx).await;
        let logs: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                RunEvent::Log(l) => Some(l),
                RunEvent::Status(_) => None,
            })
            .collect();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].level, LogLevel::Error);
        assert_eq!(logs[0].msg.chars().count(), MAX_MESSAGE_CHARS);
        assert_eq!(logs[0].source.chars().count(), MAX_FIELD_CHARS);
        assert_eq!(logs[0].flow.as_deref().map(str::len), Some(MAX_FIELD_CHARS));
        assert_eq!(logs[0].fields.len(), 1);
    }

    #[tokio::test]
    async fn the_exit_code_says_what_happened() {
        for (code, reason) in [
            (0, ExitReason::Clean),
            (1, ExitReason::Failure),
            (2, ExitReason::Configuration),
            (3, ExitReason::PayloadVersion),
            (77, ExitReason::Failure),
        ] {
            let dir = tempfile::tempdir().expect("a temporary folder");
            let (emit, mut rx) = collector();
            let spec = script(
                dir.path(),
                &format!("echo 'error: no .env' >&2\nexit {code}"),
            );
            Supervisor::default().start(&spec, emit).expect("it starts");
            let events = until_exit(&mut rx).await;
            assert_eq!(
                exited(&events),
                &RunStatus::Exited {
                    code: Some(code),
                    signal: None,
                    reason,
                    requested: false
                }
            );
            let RunEvent::Log(error) = &events[1] else {
                panic!("the error line comes first: {events:?}")
            };
            assert_eq!(error.level, LogLevel::Error);
            assert_eq!(error.msg, "error: no .env");
            // Standard error is not output: the bot never "ran".
            assert!(!events.contains(&RunEvent::Status(RunStatus::Running)));
        }
    }

    #[tokio::test]
    async fn a_child_ended_by_a_signal_is_reported_with_it() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        let spec = script(dir.path(), "kill -9 $$");
        Supervisor::default().start(&spec, emit).expect("it starts");
        let events = until_exit(&mut rx).await;
        assert_eq!(
            exited(&events),
            &RunStatus::Exited {
                code: None,
                signal: Some(9),
                reason: ExitReason::Signal,
                requested: false
            }
        );
    }

    #[tokio::test]
    async fn stop_sends_sigterm_and_a_child_that_obeys_exits_at_once() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        let spec = script(
            dir.path(),
            "trap 'echo bye; exit 0' TERM\necho ready\nwhile :; do sleep 0.05; done",
        );
        // A long grace: only an obeyed SIGTERM can end this quickly.
        let supervisor = Supervisor::with_grace(Duration::from_secs(60));
        supervisor.start(&spec, emit).expect("it starts");
        until_running(&mut rx).await;

        let started = std::time::Instant::now();
        assert_eq!(supervisor.stop().await, StopResult::Stopped);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!supervisor.is_running());

        let events = until_exit(&mut rx).await;
        assert!(events.contains(&RunEvent::Status(RunStatus::Stopping)));
        assert!(messages(&events).contains(&"bye"));
        assert_eq!(
            exited(&events),
            &RunStatus::Exited {
                code: Some(0),
                signal: None,
                reason: ExitReason::Clean,
                requested: true
            }
        );
    }

    #[tokio::test]
    async fn a_child_that_ignores_sigterm_is_killed_after_the_grace_period() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let (emit, mut rx) = collector();
        let spec = script(
            dir.path(),
            "trap '' TERM\necho ready\nwhile :; do sleep 0.05; done",
        );
        let supervisor = Supervisor::with_grace(Duration::from_millis(300));
        supervisor.start(&spec, emit).expect("it starts");
        until_running(&mut rx).await;

        let started = std::time::Instant::now();
        assert_eq!(supervisor.stop().await, StopResult::Stopped);
        assert!(started.elapsed() >= Duration::from_millis(300));

        let events = until_exit(&mut rx).await;
        assert_eq!(
            exited(&events),
            &RunStatus::Exited {
                code: None,
                signal: Some(9),
                reason: ExitReason::Signal,
                requested: true
            }
        );
    }

    #[tokio::test]
    async fn stop_with_nothing_running_says_so_and_a_second_start_is_refused() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let supervisor = Supervisor::with_grace(Duration::from_millis(300));
        assert_eq!(supervisor.stop().await, StopResult::NotRunning);

        let (emit, mut rx) = collector();
        let spec = script(
            dir.path(),
            "trap 'exit 0' TERM\necho ready\nwhile :; do sleep 0.05; done",
        );
        supervisor.start(&spec, emit.clone()).expect("it starts");
        assert!(supervisor.is_running());
        assert_eq!(
            supervisor.start(&spec, emit.clone()),
            Err(StartError::AlreadyRunning)
        );
        until_running(&mut rx).await;
        assert_eq!(supervisor.stop().await, StopResult::Stopped);
        assert_eq!(supervisor.stop().await, StopResult::NotRunning);

        // The slot is free again as soon as the exit has been reported.
        let (emit, mut rx) = collector();
        let quick = script(dir.path(), "echo again");
        supervisor.start(&quick, emit).expect("it starts again");
        let events = until_exit(&mut rx).await;
        assert!(messages(&events).contains(&"again"));
    }

    #[tokio::test]
    async fn a_program_that_cannot_start_is_an_error_and_leaves_the_slot_free() {
        let supervisor = Supervisor::default();
        let (emit, _rx) = collector();
        let spec = Spec {
            program: PathBuf::from("/nonexistent/runner"),
            args: Vec::new(),
            env: Vec::new(),
        };
        assert_eq!(
            supervisor.start(&spec, emit),
            Err(StartError::Spawn(io::ErrorKind::NotFound))
        );
        assert!(!supervisor.is_running());
    }

    /// Whether `pid` is a live process: a zombie has exited and only waits to be reaped.
    fn alive(pid: u32) -> bool {
        fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
            !stat
                .rsplit(')')
                .next()
                .unwrap_or("")
                .trim_start()
                .starts_with('Z')
        })
    }

    #[test]
    fn dropping_the_runtime_leaves_no_child_behind() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        let (emit, mut rx) = collector();
        let spec = script(dir.path(), "echo \"pid=$$\"\nwhile :; do sleep 0.05; done");
        let supervisor = Supervisor::default();
        let pid = runtime.block_on(async {
            supervisor.start(&spec, emit).expect("it starts");
            loop {
                let event = timeout(WAIT, rx.recv()).await.expect("in time");
                if let Some(RunEvent::Log(line)) = event
                    && let Some(pid) = line.msg.strip_prefix("pid=")
                {
                    return pid.parse::<u32>().expect("a pid");
                }
            }
        });
        assert!(alive(pid));
        drop(runtime);
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while alive(pid) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(pid), "the child outlived the runtime");
    }
}
