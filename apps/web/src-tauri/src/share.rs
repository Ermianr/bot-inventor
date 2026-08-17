use std::path::PathBuf;

/// Writing a Project somewhere outside the application's own storage, so that
/// it can be handed to somebody else.
///
/// This is the one write in the application that goes to a path the user names.
/// `projects.rs` builds every path it touches from the data directory and
/// refuses an id that is not a plain name, precisely so that the webview can
/// never name a file — and the exception is here, where naming the file is the
/// whole point. What makes it safe is not a check on the path but where the
/// path comes from: the system's own save dialog, opened by the user, which is
/// the same consent a save dialog carries in every other application.
///
/// What is written is the document the editor hands over. Nothing here reads
/// it: what a Project File may hold is the schema's business, and the editor is
/// what knows it.

/// Writes a Project File at the path the user picked, replacing what is there.
///
/// A file that is already there is written over without asking, because the
/// asking already happened: the save dialog warns before it hands back a path
/// that exists, in the machine's own words.
#[tauri::command]
pub fn share_project(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);

    std::fs::write(&path, contents)
        .map_err(|error| format!("{} could not be written: {error}", path.display()))
}
