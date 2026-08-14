use std::path::{Path, PathBuf};

/// Reading and writing the `.botinv` file the user picked in a file dialog.
///
/// The dialog lives on the editor's side; what it hands back is a path, and the
/// webview cannot reach a path outside the application's own folders through
/// the file system plugin. So the file itself is read and written here, on the
/// path the editor asks for. That path is the one the user picked in a dialog —
/// the editor never invents one — and nothing here widens what a Project file
/// is: a document in, a document out, no directories listed and none removed.

/// Reads a Project document as text.
#[tauri::command]
pub fn read_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|error| format!("{path} could not be read: {error}"))
}

/// Writes a Project document, replacing whatever was there.
#[tauri::command]
pub fn write_project_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|error| format!("{path} could not be written: {error}"))
}

/// Copies a Project file beside itself before a migration rewrites it, and says
/// where the copy went. An existing backup is never overwritten: the point of
/// the backup is the version the user had, and there may be more than one.
#[tauri::command]
pub fn back_up_project_file(path: String) -> Result<String, String> {
    let backup = free_backup_path(Path::new(&path))
        .ok_or_else(|| format!("{path} already has more backups than this can name"))?;

    std::fs::copy(&path, &backup)
        .map_err(|error| format!("{path} could not be backed up: {error}"))?;

    Ok(backup.to_string_lossy().into_owned())
}

/// The first name beside `path` that no file has taken yet.
fn free_backup_path(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let folder = path.parent()?;

    // A hundred is where looking stops. Somebody with that many backups of one
    // Project has a different problem, and saying so beats renaming forever.
    (1..100).find_map(|attempt| {
        let candidate = match attempt {
            1 => folder.join(format!("{name}.backup")),
            _ => folder.join(format!("{name}.backup-{attempt}")),
        };
        (!candidate.exists()).then_some(candidate)
    })
}
