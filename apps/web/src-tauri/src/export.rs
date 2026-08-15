use std::path::PathBuf;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// An Export, run on the Node.js sidecar.
///
/// Both formats need a bundler, a file system and the Runtime's own source, and
/// the webview has none of the three. So an Export runs where a Session already
/// runs, and this side does as little as a side can: it hands the request to
/// the exporter, waits, and hands back what it said (ADR 0007).
///
/// Nothing here reads the request or the answer. Both are the Compiler's
/// protocol, defined at both ends in `packages/compiler/src/export-protocol.ts`,
/// and the editor is what understands them — repeating any of it here would be
/// a third copy to keep in step.

/// The exporter, and the bundler it cannot carry inside itself. Both names come
/// from the Compiler; they are repeated here because Rust cannot read them.
const EXPORTER_NAME: &str = "exporter.mjs";
const BUNDLER_NAME: &str = "esbuild.exe";

/// How the bundled esbuild is told where its binary went. Bundled, its own way
/// of finding it — resolving a package relative to its file — has nothing to
/// find.
const BUNDLER_PATH_VARIABLE: &str = "ESBUILD_BINARY_PATH";

/// Runs one Export and answers with everything the exporter wrote.
///
/// The answer is text rather than something parsed, because the shape of it
/// belongs to the Compiler. What this promises is only that the exporter ran
/// and that this is what it said.
#[tauri::command]
pub async fn export_project(app: AppHandle, request: String) -> Result<String, String> {
    let exporter = resource(&app, EXPORTER_NAME)?;
    let bundler = resource(&app, BUNDLER_NAME)?;

    // A Project is as large as the user made it, so the request goes in a file
    // rather than on a command line, which has a length limit. It is written
    // where the application keeps its own working files, never where the user
    // is Exporting to.
    let asked = request_path(&app)?;
    std::fs::write(&asked, &request)
        .map_err(|error| format!("the Export could not be written down: {error}"))?;

    let spawned = app
        .shell()
        .sidecar("node")
        .map_err(|error| format!("the Node.js that Exports could not be started: {error}"))?
        .env(BUNDLER_PATH_VARIABLE, bundler.to_string_lossy().into_owned())
        .args([
            exporter.to_string_lossy().into_owned(),
            asked.to_string_lossy().into_owned(),
        ])
        .spawn();

    let (mut events, _child) = match spawned {
        Ok(running) => running,
        Err(error) => {
            let _ = std::fs::remove_file(&asked);
            return Err(format!("the exporter could not be started: {error}"));
        }
    };

    let mut said = String::new();
    let mut complained = String::new();

    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => said.push_str(&String::from_utf8_lossy(&bytes)),
            // The bundler writes its warnings here. They are kept only for the
            // case where the exporter dies before answering, which is the one
            // time they are the only explanation there is.
            CommandEvent::Stderr(bytes) => complained.push_str(&String::from_utf8_lossy(&bytes)),
            _ => {}
        }
    }

    // The request held a whole Project, and it is of no use to anybody now.
    let _ = std::fs::remove_file(&asked);

    if said.trim().is_empty() && !complained.trim().is_empty() {
        return Ok(complained);
    }
    Ok(said)
}

/// Where the request is written down while the exporter reads it.
///
/// One name, reused: an Export is one at a time, and a folder filling up with
/// copies of the user's Project is worse than a file that is overwritten.
fn request_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("there is nowhere to Export from: {error}"))?
        .join("exports");

    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("{}: {error}", directory.display()))?;

    Ok(directory.join("request.json"))
}

/// One of the files that ship beside the sidecar.
fn resource(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(format!("resources/{name}"), BaseDirectory::Resource)
        .map_err(|error| format!("{name} does not ship with this Bot Inventor: {error}"))
}
