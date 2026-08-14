use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::jail::Jail;
use crate::secrets;

/// A Session: one run of a Project in Development Mode, on the Node.js sidecar.
///
/// Everything about the bot's life belongs to the application. Starting one
/// writes the entry point the Compiler rendered next to the Runtime that ships
/// with the app, runs the sidecar on it, and turns everything the process says
/// into events the editor listens to. Stopping one ends the process, and so
/// does closing the application — see `jail.rs` for the case where the
/// application does not get to close politely.
///
/// The token is read from the keychain here and put on the child's environment.
/// It is never an argument, never written to a file, and never emitted.

/// A line the bot wrote. The frontend is what decides whether it is a message
/// the Session sent on purpose or output for the panel: that protocol belongs
/// to the Compiler, which is where both ends of it are defined.
pub const OUTPUT_EVENT: &str = "session://output";

/// The bot's process is gone, for any reason including Stop.
pub const EXIT_EVENT: &str = "session://exited";

/// The entry point the sidecar is pointed at, and the Runtime beside it. Both
/// names come from the Compiler; they are repeated here because Rust cannot
/// read them from it.
const ENTRY_NAME: &str = "bot.mjs";
const RUNTIME_NAME: &str = "runtime.mjs";

/// The environment variable the bot reads its token from, in a Session exactly
/// as in an Export.
const TOKEN_VARIABLE: &str = "DISCORD_TOKEN";

#[derive(Default)]
pub struct Sessions {
    running: Mutex<Option<CommandChild>>,
    jail: Jail,
}

#[derive(Clone, Serialize)]
struct Output {
    /// `stderr` is what the panel shows as a problem rather than as news.
    stream: &'static str,
    line: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    code: Option<i32>,
}

/// Why a Session could not be started, in the terms the editor reports it in.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StartFailure {
    /// There is no token for this Project yet. The editor asks for one.
    MissingSecret,
    /// Everything else: the sidecar is not there, the folder cannot be written.
    Failed { message: String },
}

/// Compiles nothing and decides nothing: it is handed the entry point the
/// Compiler rendered, and runs it.
#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    project_id: String,
    entry: String,
) -> Result<(), StartFailure> {
    let token = match secrets::read(&project_id).map_err(StartFailure::failed)? {
        Some(token) => token,
        None => return Err(StartFailure::MissingSecret),
    };

    // Running two bots for one Project would register the same commands twice
    // and answer every interaction twice with it.
    stop_running(&sessions);

    let directory = prepare(&app, &project_id, &entry).map_err(StartFailure::failed)?;

    let (mut events, child) = app
        .shell()
        .sidecar("node")
        .map_err(StartFailure::failed)?
        .current_dir(directory.clone())
        .env(TOKEN_VARIABLE, token.clone())
        .args([ENTRY_NAME])
        .spawn()
        .map_err(StartFailure::failed)?;

    sessions.jail.hold(child.pid());
    *sessions.running.lock().unwrap() = Some(child);

    // The token is redacted here rather than in the editor, because here is the
    // last place that has it: the webview is never sent one, so nothing it does
    // with what it receives could put a token on the screen.
    let secret = token;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let emitted = match event {
                CommandEvent::Stdout(bytes) => {
                    app.emit(OUTPUT_EVENT, Output::of("stdout", bytes, &secret))
                }
                CommandEvent::Stderr(bytes) => {
                    app.emit(OUTPUT_EVENT, Output::of("stderr", bytes, &secret))
                }
                CommandEvent::Terminated(payload) => app.emit(EXIT_EVENT, Exit { code: payload.code }),
                _ => Ok(()),
            };
            // The window can be gone before the process is. Losing an event
            // then is expected, and is not worth taking the task down over.
            if emitted.is_err() {
                break;
            }
        }
    });

    Ok(())
}

/// Stops the running bot. Stopping when nothing is running is not an error:
/// what the caller asked for is already true.
#[tauri::command]
pub fn stop_session(sessions: State<'_, Sessions>) {
    stop_running(&sessions);
}

fn stop_running(sessions: &Sessions) {
    let child = sessions.running.lock().unwrap().take();
    if let Some(child) = child {
        // The process is being told to go, so failing to kill one that has
        // already gone is the outcome we wanted.
        let _ = child.kill();
    }
}

/// Kills whatever is running, for the application's own shutdown.
pub fn stop_everything(app: &AppHandle) {
    if let Some(sessions) = app.try_state::<Sessions>() {
        stop_running(&sessions);
    }
}

/// Writes the folder a Session runs in: the entry point, and the Runtime that
/// ships with the application copied in beside it.
///
/// It is rewritten on every Run and kept out of the Project's own folder — it
/// is a thing the application runs, not a thing the user owns.
fn prepare(app: &AppHandle, project_id: &str, entry: &str) -> Result<PathBuf, String> {
    let runtime = app
        .path()
        .resolve(format!("resources/{RUNTIME_NAME}"), BaseDirectory::Resource)
        .map_err(|error| format!("the Runtime that ships with Bot Inventor is missing: {error}"))?;

    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("there is nowhere to run the bot from: {error}"))?
        .join("sessions")
        .join(folder_name(project_id));

    fs::create_dir_all(&directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    fs::copy(&runtime, directory.join(RUNTIME_NAME))
        .map_err(|error| format!("the Runtime could not be put in place: {error}"))?;
    fs::write(directory.join(ENTRY_NAME), entry)
        .map_err(|error| format!("the bot could not be written: {error}"))?;

    Ok(directory)
}

/// A Project's id is opaque and can be anything, including something that is
/// not a folder name. What matters is only that two Projects do not collide.
fn folder_name(project_id: &str) -> String {
    let safe: String = project_id
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect();
    format!("{safe}-{:x}", fnv1a(project_id))
}

/// FNV-1a. Enough of a hash to keep two Projects whose ids differ only in what the
/// sanitising above dropped from landing in the same folder.
fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

impl Output {
    /// One line the bot wrote, with the token taken out of it.
    ///
    /// This is where it happens because this is the last place that has the
    /// stored token: the webview is never sent one, so nothing it does with
    /// what it receives could put a token on the screen.
    fn of(stream: &'static str, bytes: Vec<u8>, secret: &str) -> Self {
        let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
        Self {
            stream,
            line: if secret.is_empty() {
                line
            } else {
                line.replace(secret, "[redacted]")
            },
        }
    }
}

impl StartFailure {
    fn failed(error: impl std::fmt::Display) -> Self {
        Self::Failed {
            message: error.to_string(),
        }
    }
}
