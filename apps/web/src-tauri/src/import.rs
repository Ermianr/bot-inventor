use std::path::PathBuf;

/// Reading a Project File from outside the application's own storage, so that
/// one somebody sent can be taken in.
///
/// This is the mirror of `share.rs`, and it is safe for the same reason: not a
/// check on the path but where the path comes from — the system's own open
/// dialog, opened by the user, which is what picking a file to open means in
/// every other application. `projects.rs` still builds every path it owns from
/// the data directory, and nothing here goes near it.
///
/// Nothing here reads what it read: whether the text is a Project is the
/// schema's business, and the editor is what knows it.

/// Hands back the contents of the file the user picked.
#[tauri::command]
pub fn read_project_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);

    std::fs::read_to_string(&path)
        .map_err(|error| format!("{} could not be read: {error}", path.display()))
}
