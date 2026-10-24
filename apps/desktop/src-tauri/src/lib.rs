//! The Tauri app. Every command validates its input here, in Rust: the webview is untrusted
//! (`docs/DEVELOPMENT-GUIDE.md` §7).

use std::path::Path;

use anyhow::Result;
use serde::Serialize;
use specta::Type;
use specta_typescript::Typescript;
use tauri_specta::{Builder, collect_commands};

pub mod editor;

/// What the app tells the frontend about itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

fn info() -> AppInfo {
    AppInfo {
        name: "Bot Inventor".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[tauri::command]
#[specta::specta]
fn app_info() -> AppInfo {
    info()
}

/// The commands and events shared with the frontend; also the source of the generated types.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .disable_serde_phases()
        .commands(collect_commands![
            app_info,
            editor::new_project,
            editor::open_project,
            editor::save_project,
            editor::validate_project,
            editor::node_catalog,
        ])
}

/// Writes the TypeScript types of the commands to `path` (`cargo xtask bindings`).
pub fn export_bindings(path: impl AsRef<Path>) -> Result<()> {
    specta_builder().export(Typescript::default(), path)?;
    Ok(())
}

pub fn run() -> tauri::Result<()> {
    let builder = specta_builder();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(editor::EditorState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_names_the_app_and_its_version() {
        let info = app_info();
        assert_eq!(info.name, "Bot Inventor");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }
}
