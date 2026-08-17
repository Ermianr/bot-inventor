use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// The Projects the application owns.
///
/// Every Project is a folder under `projects/` in the application's data
/// directory, named after the Project's id, holding the `.botinv` document and
/// the machine-local settings for that Project beside it. Deleting a Project is
/// deleting one folder, which is the whole reason the folder exists: there is
/// no second place for a stray file to survive.
///
/// Every path in here is built from the application's data directory and an id
/// the editor hands over. The editor never invents a path — the same posture
/// `jail.rs` takes with what it guards — and an id that is not a plain name is
/// refused outright, so a Project id can never walk out of `projects/`.
///
/// There is no index file. Listing reads the documents themselves, so there is
/// no second source of truth to drift out of step the first time a write fails
/// halfway.

/// The document inside a Project's folder. The name is the same for every
/// Project: the folder is what tells them apart.
const DOCUMENT: &str = "project.botinv";

/// What belongs to this machine rather than to the Project, beside the document
/// so it dies with it.
const SETTINGS: &str = "settings.json";

/// A Project as the Dashboard reads it: the document itself, and when it last
/// changed. The name is inside the document, and read there rather than here —
/// what a Project is called is the editor's business, not this module's.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub id: String,
    pub document: String,
    /// Milliseconds since the epoch, as the webview counts time.
    pub changed_at: f64,
}

/// The settings that sit beside a Project and never travel with it.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    /// The server a Session registers this Project's commands on.
    test_server_id: String,
}

/// The folder holding every Project, made if it is not there yet.
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("this machine has nowhere to keep your Projects: {error}"))?
        .join("projects");

    std::fs::create_dir_all(&root)
        .map_err(|error| format!("{} could not be made: {error}", root.display()))?;

    Ok(root)
}

/// One Project's folder.
///
/// The id is checked rather than trusted: it arrives from the webview, and a
/// path separator or a `..` in it would put the folder somewhere else entirely.
/// Ids are made by the editor as `project-<uuid>`, so anything outside letters,
/// digits and a dash is a bug or an attack, and both are refused the same way.
fn folder(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let named = !project_id.is_empty()
        && project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');

    if !named {
        return Err(format!("{project_id} is not a Project id"));
    }

    Ok(root(app)?.join(project_id))
}

/// Every Project the application holds, in no particular order — the Dashboard
/// decides what order to show them in.
///
/// A folder without a readable document is skipped rather than reported: a
/// half-written Project must not be what stands between the user and the rest
/// of their work.
#[tauri::command]
pub fn list_projects(app: tauri::AppHandle) -> Result<Vec<StoredProject>, String> {
    let root = root(&app)?;
    let entries = std::fs::read_dir(&root)
        .map_err(|error| format!("{} could not be read: {error}", root.display()))?;

    let mut projects = Vec::new();

    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let document_path = entry.path().join(DOCUMENT);
        let Ok(document) = std::fs::read_to_string(&document_path) else {
            continue;
        };

        projects.push(StoredProject {
            id,
            document,
            changed_at: changed_at(&document_path),
        });
    }

    Ok(projects)
}

/// When the document was last written, in the webview's own units. A file whose
/// time this machine will not answer for reads as the epoch, which sorts it
/// last rather than hiding the Project.
fn changed_at(path: &std::path::Path) -> f64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |since| since.as_millis() as f64)
}

/// Makes a Project's folder and writes its document.
///
/// A folder that is already there is refused rather than written over: an id
/// collision means two Projects would share one folder, and with it one Secret.
#[tauri::command]
pub fn create_project(
    app: tauri::AppHandle,
    project_id: String,
    contents: String,
) -> Result<(), String> {
    let folder = folder(&app, &project_id)?;
    if folder.exists() {
        return Err(format!("there is already a Project called {project_id}"));
    }

    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("{} could not be made: {error}", folder.display()))?;

    write_project(app, project_id, contents)
}

/// Deletes a Project's folder, and everything the application ever put in it.
///
/// One call takes the document, the settings beside it and every backup with
/// it, which is the whole reason a Project is a folder rather than a file: there
/// is no second place for a stray piece of a deleted Project to survive. The
/// Secret is not here — it is not in the folder — and it is deleted first, by
/// the caller, so that a folder that refuses to go never strands a token.
///
/// A folder that is not there is not a failure: what was asked for is that the
/// Project be gone, and it is.
#[tauri::command]
pub fn delete_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let folder = folder(&app, &project_id)?;
    if !folder.exists() {
        return Ok(());
    }

    std::fs::remove_dir_all(&folder)
        .map_err(|error| format!("{} could not be deleted: {error}", folder.display()))
}

/// Reads a Project's document as text.
#[tauri::command]
pub fn read_project(app: tauri::AppHandle, project_id: String) -> Result<String, String> {
    let path = folder(&app, &project_id)?.join(DOCUMENT);
    std::fs::read_to_string(&path)
        .map_err(|error| format!("{} could not be read: {error}", path.display()))
}

/// Writes a Project's document, replacing what was there.
#[tauri::command]
pub fn write_project(
    app: tauri::AppHandle,
    project_id: String,
    contents: String,
) -> Result<(), String> {
    let path = folder(&app, &project_id)?.join(DOCUMENT);
    std::fs::write(&path, contents)
        .map_err(|error| format!("{} could not be written: {error}", path.display()))
}

/// Copies a Project's document beside itself before a migration rewrites it, and
/// says where the copy went. An existing backup is never overwritten: the point
/// of a backup is the version the user had, and there may be more than one.
#[tauri::command]
pub fn back_up_project(app: tauri::AppHandle, project_id: String) -> Result<String, String> {
    let path = folder(&app, &project_id)?.join(DOCUMENT);

    // A hundred is where looking stops. Somebody with that many backups of one
    // Project has a different problem, and saying so beats renaming forever.
    let backup = (1..100)
        .map(|attempt| match attempt {
            1 => path.with_file_name(format!("{DOCUMENT}.backup")),
            _ => path.with_file_name(format!("{DOCUMENT}.backup-{attempt}")),
        })
        .find(|candidate| !candidate.exists())
        .ok_or_else(|| format!("{project_id} already has more backups than this can name"))?;

    std::fs::copy(&path, &backup)
        .map_err(|error| format!("{} could not be backed up: {error}", path.display()))?;

    Ok(backup.to_string_lossy().into_owned())
}

/// The Test Server this machine tests the Project on, or nothing when the user
/// has not picked one. A settings file that cannot be read is treated as one
/// that is not there: a setting is not worth refusing to open a Project over.
#[tauri::command]
pub fn read_test_server(app: tauri::AppHandle, project_id: String) -> Result<String, String> {
    let path = folder(&app, &project_id)?.join(SETTINGS);
    let settings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Settings>(&contents).ok())
        .unwrap_or_default();

    Ok(settings.test_server_id)
}

/// Remembers the Test Server, so the user picks one once rather than before
/// every run.
#[tauri::command]
pub fn write_test_server(
    app: tauri::AppHandle,
    project_id: String,
    test_server_id: String,
) -> Result<(), String> {
    let path = folder(&app, &project_id)?.join(SETTINGS);
    let settings = Settings { test_server_id };

    let contents = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("this setting could not be written: {error}"))?;

    std::fs::write(&path, contents)
        .map_err(|error| format!("{} could not be written: {error}", path.display()))
}
