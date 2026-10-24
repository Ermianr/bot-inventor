//! The commands that run a bot on this machine and export it: compile, start and stop the
//! runner, the token and the development server in `.env`, and the export.
//!
//! The webview sends the project it shows and never a path; the folder of the open project stays
//! in [`EditorState`]. The token goes in and never comes back (`dotenv`).

use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use exporter::{Export, ExportError};
use graph::Project;
use runtime::compile;
use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::dotenv::{self, RunSettings, Token};
use crate::editor::{DiagnosticView, EditorError, EditorState, check_project_name, pick_folder};
use crate::supervisor::{Emit, RunEvent, Spec, StartError, StopResult, Supervisor};

pub const PAYLOAD_VAR: &str = "BOT_INVENTOR_PAYLOAD";
pub const ENV_FILE_VAR: &str = "BOT_INVENTOR_ENV_FILE";
pub const ASSETS_DIR_VAR: &str = "BOT_INVENTOR_ASSETS_DIR";
pub const DATA_DIR_VAR: &str = "BOT_INVENTOR_DATA_DIR";

/// The local state of a project, ignored by git (`.gitignore` is generated with it).
const LOCAL_DIR: &str = ".botinventor";
const RUN_DIR: &str = "run";
const PAYLOAD_FILE: &str = "payload.bin";
const DATA_DIR: &str = "data";
/// The runner next to the app's executable, where Tauri puts a bundled `externalBin`.
const RUNNER: &str = "runner";

/// Why a command failed. The message is for the person using the app and names no secret.
#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum RunError {
    /// The webview sent something that is not valid.
    #[error("{0}")]
    InvalidInput(String),
    /// A command needs an open project and there is none.
    #[error("no project is open")]
    NoProject,
    /// A bot is already running.
    #[error("a bot is already running")]
    AlreadyRunning,
    /// A file or folder of the project could not be used.
    #[error("{0}")]
    Files(String),
    /// The runner could not be started.
    #[error("{0}")]
    Spawn(String),
    /// The export failed.
    #[error("{0}")]
    Export(String),
}

impl From<EditorError> for RunError {
    fn from(error: EditorError) -> Self {
        match error {
            EditorError::InvalidInput(message) => Self::InvalidInput(message),
            EditorError::Project(message) => Self::Files(message),
            EditorError::NoProject => Self::NoProject,
        }
    }
}

impl From<ExportError> for RunError {
    fn from(error: ExportError) -> Self {
        match error {
            ExportError::InvalidName { .. } => Self::InvalidInput(error.to_string()),
            other => Self::Export(other.to_string()),
        }
    }
}

/// The bot that runs on this machine, if any.
#[derive(Default)]
pub struct RunState {
    pub supervisor: Supervisor,
}

/// What compile made of the project.
pub enum Compiled {
    Ready(Box<graph::Payload>),
    Invalid(Vec<DiagnosticView>),
}

/// Compiles the project the webview sent. A project with an error never gets further.
///
/// # Errors
///
/// `InvalidInput` for a project name that is not valid.
pub fn compile_project(project: &Project) -> Result<Compiled, RunError> {
    check_project_name(&project.manifest.name)?;
    let report = compile::compile(project, env!("CARGO_PKG_VERSION"));
    match report.payload {
        Some(payload) if !report.has_errors() => Ok(Compiled::Ready(Box::new(payload))),
        _ => Ok(Compiled::Invalid(
            report
                .diagnostics
                .iter()
                .map(DiagnosticView::from)
                .collect(),
        )),
    }
}

/// The folders and files of a local run, all inside the project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunPaths {
    pub payload: PathBuf,
    pub env_file: PathBuf,
    pub assets: PathBuf,
    pub data: PathBuf,
}

impl RunPaths {
    #[must_use]
    pub fn new(folder: &Path) -> Self {
        let local = folder.join(LOCAL_DIR);
        Self {
            payload: local.join(RUN_DIR).join(PAYLOAD_FILE),
            env_file: folder.join(".env"),
            assets: folder.join("assets"),
            data: local.join(DATA_DIR),
        }
    }

    /// The whole environment of the runner: the four variables and nothing else. The token is
    /// not among them; the runner reads it from `.env`.
    #[must_use]
    pub fn environment(&self) -> Vec<(OsString, OsString)> {
        [
            (PAYLOAD_VAR, &self.payload),
            (ENV_FILE_VAR, &self.env_file),
            (ASSETS_DIR_VAR, &self.assets),
            (DATA_DIR_VAR, &self.data),
        ]
        .into_iter()
        .map(|(name, path)| (OsString::from(name), path.clone().into_os_string()))
        .collect()
    }
}

/// A folder that is the real one, not a link to somewhere else.
fn plain_dir(path: &Path) -> Result<(), RunError> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| RunError::Files(format!("cannot read the local folder ({})", e.kind())))?;
    if meta.file_type().is_dir() {
        Ok(())
    } else {
        Err(RunError::Files(
            "the local folder `.botinventor` has a link or a file where a folder goes".to_owned(),
        ))
    }
}

/// Writes the payload for a local run, through a temporary file and a rename, with mode 0600.
fn write_payload(paths: &RunPaths, payload: &graph::Payload) -> Result<(), RunError> {
    use std::os::unix::fs::DirBuilderExt;
    let bytes = payload
        .encode()
        .map_err(|e| RunError::Files(format!("cannot encode the payload: {e}")))?;
    let Some(run_dir) = paths.payload.parent() else {
        return Err(RunError::Files("the payload has no folder".to_owned()));
    };
    let Some(local_dir) = run_dir.parent() else {
        return Err(RunError::Files("the payload has no folder".to_owned()));
    };
    for dir in [local_dir, run_dir] {
        if fs::symlink_metadata(dir).is_err() {
            fs::DirBuilder::new().mode(0o700).create(dir).map_err(|e| {
                RunError::Files(format!("cannot create a local folder ({})", e.kind()))
            })?;
        }
        plain_dir(dir)?;
    }
    let files =
        |e: std::io::Error| RunError::Files(format!("cannot write the payload ({})", e.kind()));
    // `NamedTempFile` is created with mode 0600.
    let mut temporary = tempfile::NamedTempFile::new_in(run_dir).map_err(files)?;
    temporary.write_all(&bytes).map_err(files)?;
    temporary.as_file().sync_all().map_err(files)?;
    temporary
        .persist(&paths.payload)
        .map_err(|e| files(e.error))?;
    Ok(())
}

/// What `start_bot` answers when it did not fail.
#[derive(Debug, Serialize, Type)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum StartOutcome {
    Started,
    /// The project has errors: nothing was started.
    Invalid {
        diagnostics: Vec<DiagnosticView>,
    },
}

/// Compiles `project` and starts `runner` on it, in `folder`.
///
/// # Errors
///
/// `InvalidInput` for a bad project name, `Files` when the payload cannot be written,
/// `AlreadyRunning` and `Spawn` from the supervisor.
pub fn start_in(
    supervisor: &Supervisor,
    runner: &Path,
    folder: &Path,
    project: &Project,
    emit: Emit,
) -> Result<StartOutcome, RunError> {
    if supervisor.is_running() {
        return Err(RunError::AlreadyRunning);
    }
    let payload = match compile_project(project)? {
        Compiled::Ready(payload) => payload,
        Compiled::Invalid(diagnostics) => return Ok(StartOutcome::Invalid { diagnostics }),
    };
    let paths = RunPaths::new(folder);
    write_payload(&paths, &payload)?;
    let spec = Spec {
        program: runner.to_path_buf(),
        args: Vec::new(),
        env: paths.environment(),
    };
    supervisor.start(&spec, emit).map_err(|error| match error {
        StartError::AlreadyRunning => RunError::AlreadyRunning,
        StartError::Spawn(kind) => RunError::Spawn(format!("cannot start the runner ({kind})")),
    })?;
    Ok(StartOutcome::Started)
}

/// The runner that Tauri bundled next to the app (`bundle.externalBin`). Local run and export use
/// this one file.
fn bundled_runner() -> Result<PathBuf, RunError> {
    let missing = || RunError::Spawn("the runner is not installed with the app".to_owned());
    let exe = std::env::current_exe().map_err(|_| missing())?;
    let runner = exe.parent().ok_or_else(missing)?.join(RUNNER);
    if runner.is_file() {
        Ok(runner)
    } else {
        Err(missing())
    }
}

fn open_folder(editor: &EditorState) -> Result<PathBuf, RunError> {
    editor.get().ok_or(RunError::NoProject)
}

/// Compiles the project and starts the bot; its output arrives through `events`.
#[tauri::command]
#[specta::specta]
pub async fn start_bot(
    editor: State<'_, EditorState>,
    run: State<'_, RunState>,
    project: Project,
    events: Channel<RunEvent>,
) -> Result<StartOutcome, RunError> {
    let folder = open_folder(&editor)?;
    let runner = bundled_runner()?;
    let emit: Emit = Arc::new(move |event| {
        // A closed channel means the window is gone; there is nobody to tell.
        let _ = events.send(event);
    });
    start_in(&run.supervisor, &runner, &folder, &project, emit)
}

/// Stops the bot: `SIGTERM`, then a kill after ten seconds.
#[tauri::command]
#[specta::specta]
pub async fn stop_bot(run: State<'_, RunState>) -> Result<StopResult, RunError> {
    Ok(run.supervisor.stop().await)
}

/// Writes the bot token to the project's `.env`. The token is never read back.
#[tauri::command]
#[specta::specta]
pub async fn set_token(editor: State<'_, EditorState>, token: Token) -> Result<(), RunError> {
    dotenv::set_token(&open_folder(&editor)?, &token)
}

/// Whether a token is set, and the development server; never the token.
#[tauri::command]
#[specta::specta]
pub async fn token_status(editor: State<'_, EditorState>) -> Result<RunSettings, RunError> {
    dotenv::settings(&open_folder(&editor)?)
}

/// Sets the development server (the commands are then created only there), or removes it.
#[tauri::command]
#[specta::specta]
pub async fn set_dev_guild(
    editor: State<'_, EditorState>,
    guild: Option<String>,
) -> Result<(), RunError> {
    dotenv::set_dev_guild(&open_folder(&editor)?, guild.as_deref())
}

/// What `export_bot` answers when it did not fail.
#[derive(Debug, Serialize, Type)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ExportOutcome {
    /// The folder was written. The path is for display only.
    Exported { path: String, assets: u32 },
    /// The project has errors: nothing was written.
    Invalid { diagnostics: Vec<DiagnosticView> },
}

/// Compiles `project` and writes the bot to `out` with `runner`.
///
/// # Errors
///
/// `InvalidInput` for a bad project or bot name, `Export` for anything the exporter refuses.
pub fn export_in(
    runner: &Path,
    folder: &Path,
    out: &Path,
    project: &Project,
    name: &str,
) -> Result<ExportOutcome, RunError> {
    exporter::check_name(name)?;
    let payload = match compile_project(project)? {
        Compiled::Ready(payload) => payload,
        Compiled::Invalid(diagnostics) => return Ok(ExportOutcome::Invalid { diagnostics }),
    };
    let exported = exporter::export(&Export {
        runner,
        payload: &payload,
        project: folder,
        out,
        name,
    })?;
    Ok(ExportOutcome::Exported {
        path: out.display().to_string(),
        assets: u32::try_from(exported.assets).unwrap_or(u32::MAX),
    })
}

/// Asks for the output folder and exports the bot there; `None` when the person cancels.
#[tauri::command]
#[specta::specta]
pub async fn export_bot(
    app: AppHandle,
    editor: State<'_, EditorState>,
    project: Project,
    name: String,
) -> Result<Option<ExportOutcome>, RunError> {
    let folder = open_folder(&editor)?;
    // Check before the dialog, so a bad name does not make the person pick a folder first.
    exporter::check_name(&name)?;
    check_project_name(&project.manifest.name)?;
    let runner = bundled_runner()?;
    let Some(out) = pick_folder(&app).await? else {
        return Ok(None);
    };
    export_in(&runner, &folder, &out, &project, &name).map(Some)
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use tokio::sync::mpsc;
    use tokio::time::timeout;

    use super::*;
    use crate::editor;
    use crate::supervisor::{ExitReason, RunStatus};

    const PING: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../crates/graph/tests/samples/v1/ping"
    );
    const MARKER: &str = "MARKER-token.AbC_123-xyz";

    fn ping() -> Project {
        editor::open_in(Path::new(PING))
            .expect("the ping sample opens")
            .project
    }

    fn broken() -> Project {
        let mut project = ping();
        for flow in project.flows.values_mut() {
            for node in &mut flow.nodes {
                node.settings.remove("content");
            }
        }
        project
    }

    /// A stand-in for the runner that prints its environment and exits.
    fn standin(dir: &Path) -> PathBuf {
        let path = dir.join("standin-runner");
        fs::write(&path, "#!/bin/sh\nenv\nexit 0\n").expect("a script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("a mode");
        path
    }

    /// The runner that Tauri copied next to the test executable.
    fn real_runner() -> PathBuf {
        let exe = std::env::current_exe().expect("the test executable");
        let runner = exe
            .parent()
            .and_then(Path::parent)
            .expect("target/debug")
            .join(RUNNER);
        assert!(
            runner.is_file(),
            "{} is missing: run the tests with `cargo xtask test`, which builds the runner",
            runner.display()
        );
        runner
    }

    fn collector() -> (Emit, mpsc::UnboundedReceiver<RunEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let emit: Emit = Arc::new(move |event| {
            let _ = tx.send(event);
        });
        (emit, rx)
    }

    async fn lines_until_exit(
        rx: &mut mpsc::UnboundedReceiver<RunEvent>,
    ) -> (Vec<String>, RunStatus) {
        let mut lines = Vec::new();
        loop {
            match timeout(Duration::from_secs(20), rx.recv())
                .await
                .expect("in time")
                .expect("open")
            {
                RunEvent::Log(line) => lines.push(line.msg),
                RunEvent::Status(status @ RunStatus::Exited { .. }) => return (lines, status),
                RunEvent::Status(_) => {}
            }
        }
    }

    #[test]
    fn the_runner_environment_is_the_four_variables_inside_the_project() {
        let paths = RunPaths::new(Path::new("/projects/bot"));
        let env: Vec<(String, String)> = paths
            .environment()
            .into_iter()
            .map(|(k, v)| {
                (
                    k.into_string().expect("text"),
                    v.into_string().expect("text"),
                )
            })
            .collect();
        assert_eq!(
            env,
            [
                (
                    "BOT_INVENTOR_PAYLOAD".to_owned(),
                    "/projects/bot/.botinventor/run/payload.bin".to_owned()
                ),
                (
                    "BOT_INVENTOR_ENV_FILE".to_owned(),
                    "/projects/bot/.env".to_owned()
                ),
                (
                    "BOT_INVENTOR_ASSETS_DIR".to_owned(),
                    "/projects/bot/assets".to_owned()
                ),
                (
                    "BOT_INVENTOR_DATA_DIR".to_owned(),
                    "/projects/bot/.botinventor/data".to_owned()
                ),
            ]
        );
    }

    #[tokio::test]
    async fn start_compiles_writes_the_payload_and_starts_with_only_the_four_variables() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let folder = dir.path().join("project");
        fs::create_dir(&folder).expect("a folder");
        // A token in the project must not reach the child's environment.
        dotenv::set_token(&folder, &Token::new(MARKER)).expect("it writes");
        let supervisor = Supervisor::default();
        let (emit, mut rx) = collector();

        let outcome =
            start_in(&supervisor, &standin(dir.path()), &folder, &ping(), emit).expect("it starts");
        assert!(matches!(outcome, StartOutcome::Started));
        let (lines, status) = lines_until_exit(&mut rx).await;

        assert!(matches!(
            status,
            RunStatus::Exited {
                reason: ExitReason::Clean,
                ..
            }
        ));
        let payload = folder.join(".botinventor/run/payload.bin");
        for variable in [
            format!("BOT_INVENTOR_PAYLOAD={}", payload.display()),
            format!("BOT_INVENTOR_ENV_FILE={}", folder.join(".env").display()),
            format!(
                "BOT_INVENTOR_ASSETS_DIR={}",
                folder.join("assets").display()
            ),
            format!(
                "BOT_INVENTOR_DATA_DIR={}",
                folder.join(".botinventor/data").display()
            ),
        ] {
            assert!(
                lines.contains(&variable),
                "{variable} is missing in {lines:?}"
            );
        }
        for line in &lines {
            let key = line.split('=').next().unwrap_or_default();
            assert!(
                key.starts_with("BOT_INVENTOR_") || matches!(key, "PWD" | "SHLVL" | "_" | "OLDPWD"),
                "an unexpected variable: {key}"
            );
            assert!(!line.contains(MARKER));
        }
        assert_eq!(
            fs::metadata(&payload)
                .expect("the payload")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        // It is the compiled Ping, not something else.
        let bytes = fs::read(&payload).expect("it reads");
        let expected = match compile_project(&ping()).expect("it compiles") {
            Compiled::Ready(payload) => payload.encode().expect("it encodes"),
            Compiled::Invalid(_) => panic!("ping compiles"),
        };
        assert_eq!(bytes, expected);
    }

    #[tokio::test]
    async fn a_project_with_errors_starts_nothing_and_returns_its_diagnostics() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let supervisor = Supervisor::default();
        let (emit, _rx) = collector();
        let outcome = start_in(
            &supervisor,
            &standin(dir.path()),
            dir.path(),
            &broken(),
            emit,
        )
        .expect("it answers");
        let StartOutcome::Invalid { diagnostics } = outcome else {
            panic!("the project has errors")
        };
        assert!(
            diagnostics
                .iter()
                .any(|d| d.path.as_deref() == Some("content"))
        );
        assert!(!supervisor.is_running());
        assert!(!dir.path().join(LOCAL_DIR).exists());
    }

    #[tokio::test]
    async fn a_second_start_a_bad_name_and_a_missing_runner_are_refused() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let supervisor = Supervisor::default();
        let (emit, _rx) = collector();
        let sleeper = dir.path().join("sleeper");
        fs::write(&sleeper, "#!/bin/sh\nsleep 30\n").expect("a script");
        fs::set_permissions(&sleeper, fs::Permissions::from_mode(0o755)).expect("a mode");

        start_in(&supervisor, &sleeper, dir.path(), &ping(), emit.clone()).expect("it starts");
        assert!(matches!(
            start_in(&supervisor, &sleeper, dir.path(), &ping(), emit.clone()),
            Err(RunError::AlreadyRunning)
        ));
        supervisor.stop().await;

        let mut unnamed = ping();
        unnamed.manifest.name = "line\nbreak".to_owned();
        assert!(matches!(
            start_in(&supervisor, &sleeper, dir.path(), &unnamed, emit.clone()),
            Err(RunError::InvalidInput(_))
        ));
        assert!(matches!(
            start_in(
                &supervisor,
                &dir.path().join("missing"),
                dir.path(),
                &ping(),
                emit
            ),
            Err(RunError::Spawn(_))
        ));
    }

    #[tokio::test]
    async fn a_project_folder_that_has_gone_is_an_error_and_starts_nothing() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let supervisor = Supervisor::default();
        let (emit, _rx) = collector();
        let gone = dir.path().join("gone");
        let result = start_in(&supervisor, &standin(dir.path()), &gone, &ping(), emit);
        assert!(matches!(result, Err(RunError::Files(_))));
        assert!(!supervisor.is_running());
        assert!(!gone.exists());
    }

    #[tokio::test]
    async fn a_link_in_the_local_folder_is_refused() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let elsewhere = dir.path().join("elsewhere");
        fs::create_dir(&elsewhere).expect("a folder");
        let folder = dir.path().join("project");
        fs::create_dir(&folder).expect("a folder");
        std::os::unix::fs::symlink(&elsewhere, folder.join(LOCAL_DIR)).expect("a link");
        let (emit, _rx) = collector();
        let result = start_in(
            &Supervisor::default(),
            &standin(dir.path()),
            &folder,
            &ping(),
            emit,
        );
        assert!(matches!(result, Err(RunError::Files(_))));
        assert_eq!(fs::read_dir(&elsewhere).expect("it lists").count(), 0);
    }

    #[test]
    fn export_writes_the_folder_of_the_bot_and_never_the_token() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let folder = dir.path().join("project");
        fs::create_dir_all(folder.join("assets")).expect("a folder");
        fs::write(folder.join("assets/logo.txt"), "logo").expect("an asset");
        dotenv::set_token(&folder, &Token::new(MARKER)).expect("it writes");
        fs::create_dir_all(folder.join(".botinventor/data")).expect("a folder");
        fs::write(folder.join(".botinventor/data/bot.sqlite"), "database").expect("a file");
        let out = dir.path().join("out");

        let outcome =
            export_in(&real_runner(), &folder, &out, &ping(), "ping-bot").expect("it exports");
        let ExportOutcome::Exported { path, assets } = outcome else {
            panic!("ping exports")
        };
        assert_eq!(path, out.display().to_string());
        assert_eq!(assets, 1);

        assert!(out.join("ping-bot").is_file());
        assert!(out.join("assets/logo.txt").is_file());
        assert!(out.join(".env.example").is_file());
        assert!(!out.join(".env").exists());
        assert!(!out.join("data").exists());
        for entry in fs::read_dir(&out).expect("it lists") {
            let path = entry.expect("an entry").path();
            if path.is_file() {
                let bytes = fs::read(&path).expect("it reads");
                assert!(
                    !bytes.windows(MARKER.len()).any(|w| w == MARKER.as_bytes()),
                    "the token is in {}",
                    path.display()
                );
            }
        }
    }

    #[tokio::test]
    async fn the_exported_bot_carries_the_payload_that_a_local_run_writes() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let folder = dir.path().join("project");
        fs::create_dir(&folder).expect("a folder");
        let out = dir.path().join("out");
        let runner = real_runner();
        export_in(&runner, &folder, &out, &ping(), "ping-bot").expect("it exports");

        let dump = |program: &Path, args: &[&OsString]| {
            let output = std::process::Command::new(program)
                .args(args)
                .env_clear()
                .output()
                .expect("it runs");
            assert!(output.status.success(), "{output:?}");
            String::from_utf8(output.stdout).expect("text")
        };
        let flag = OsString::from("--dump");
        let exported = dump(&out.join("ping-bot"), &[&flag]);

        let (emit, _rx) = collector();
        let supervisor = Supervisor::default();
        start_in(&supervisor, &standin(dir.path()), &folder, &ping(), emit).expect("it starts");
        supervisor.stop().await;
        let local = dump(
            &runner,
            &[
                &flag,
                &OsString::from("--payload"),
                &folder.join(".botinventor/run/payload.bin").into_os_string(),
            ],
        );
        assert_eq!(exported, local);
        assert!(exported.contains("ping"));
    }

    #[test]
    fn export_refuses_what_it_should_and_writes_nothing() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let folder = dir.path().join("project");
        fs::create_dir_all(folder.join("assets")).expect("a folder");
        let runner = standin(dir.path());
        let out = dir.path().join("out");

        // A project with an error.
        let outcome = export_in(&runner, &folder, &out, &broken(), "bot").expect("it answers");
        assert!(matches!(outcome, ExportOutcome::Invalid { .. }));
        // Bad names.
        for name in ["", ".hidden", "-x", "a/b", "assets", "data", "tab\t"] {
            assert!(
                matches!(
                    export_in(&runner, &folder, &out, &ping(), name),
                    Err(RunError::InvalidInput(_))
                ),
                "{name:?}"
            );
        }
        // An output inside the project's assets.
        assert!(matches!(
            export_in(&runner, &folder, &folder.join("assets/out"), &ping(), "bot"),
            Err(RunError::Export(_))
        ));
        assert!(!out.exists());
        assert!(!folder.join("assets/out").exists());
    }

    #[tokio::test]
    async fn nothing_that_the_commands_return_has_the_token() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let folder = dir.path().join("project");
        fs::create_dir(&folder).expect("a folder");
        dotenv::set_token(&folder, &Token::new(MARKER)).expect("it writes");
        dotenv::set_dev_guild(&folder, Some("123")).expect("it writes");

        let mut shown = Vec::new();
        shown.push(
            serde_json::to_string(&dotenv::settings(&folder).expect("status")).expect("json"),
        );

        let (emit, mut rx) = collector();
        let supervisor = Supervisor::default();
        let started =
            start_in(&supervisor, &standin(dir.path()), &folder, &ping(), emit).expect("it starts");
        shown.push(format!("{started:?}"));
        let (lines, status) = lines_until_exit(&mut rx).await;
        shown.extend(lines);
        shown.push(format!("{status:?}"));

        let out = dir.path().join("out");
        shown.push(format!(
            "{:?}",
            export_in(&real_runner(), &folder, &out, &ping(), "bot").expect("it exports")
        ));
        for error in [
            dotenv::set_token(&folder, &Token::new("bad token")).expect_err("refused"),
            export_in(&real_runner(), &folder, &out, &ping(), "assets").expect_err("refused"),
            start_in(
                &supervisor,
                &dir.path().join("none"),
                &folder,
                &ping(),
                collector().0,
            )
            .expect_err("refused"),
        ] {
            shown.push(format!(
                "{error} {error:?} {}",
                serde_json::to_string(&error).expect("json")
            ));
        }
        shown.push(format!("{:?}", Token::new(MARKER)));
        for text in shown {
            assert!(!text.contains(MARKER), "{text}");
        }
    }
}
