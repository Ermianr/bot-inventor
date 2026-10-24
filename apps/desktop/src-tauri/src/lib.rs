//! The Tauri app. Every command validates its input here, in Rust: the webview is untrusted
//! (`docs/DEVELOPMENT-GUIDE.md` §7).

#![cfg_attr(test, allow(clippy::panic))]

use std::path::Path;

use anyhow::Result;
use serde::Serialize;
use specta::Type;
use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{Builder, collect_commands};

pub mod dotenv;
pub mod editor;
pub mod expressions;
pub mod run;
pub mod supervisor;

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
            expressions::expression_names,
            expressions::condition_to_source,
            expressions::condition_from_source,
            expressions::rename_alias,
            run::start_bot,
            run::stop_bot,
            run::set_token,
            run::token_status,
            run::set_dev_guild,
            run::export_bot,
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
        .manage(run::RunState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(|app, event| {
            // The bot does not outlive the app: stop it the same way as the stop button does.
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<run::RunState>();
                tauri::async_runtime::block_on(state.supervisor.stop());
            }
        });
    Ok(())
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

    fn read_json(path: &str) -> serde_json::Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(path);
        let text = std::fs::read_to_string(&path).expect("the file exists");
        serde_json::from_str(&text).expect("the file is JSON")
    }

    /// Only the Rust side starts processes: the window may call our own commands and nothing from
    /// a plugin, so it has no `shell:*` permission (`docs/DEVELOPMENT-GUIDE.md` §7).
    #[test]
    fn the_window_may_call_our_commands_and_no_plugin() {
        let capability = read_json("capabilities/main.json");
        let permissions = capability["permissions"].as_array().expect("a list");
        assert!(!permissions.is_empty());
        for permission in permissions {
            let name = permission.as_str().expect("a name");
            assert!(
                name.starts_with("allow-") && !name.contains(':') && !name.contains("shell"),
                "{name}"
            );
        }
        for command in [
            "start-bot",
            "stop-bot",
            "set-token",
            "token-status",
            "set-dev-guild",
            "export-bot",
        ] {
            let wanted = format!("allow-{command}");
            assert!(
                permissions.iter().any(|p| p.as_str() == Some(&wanted)),
                "{wanted}"
            );
        }
    }

    #[test]
    fn the_runner_is_bundled_as_a_sidecar() {
        let config = read_json("tauri.conf.json");
        assert_eq!(
            config["bundle"]["externalBin"],
            serde_json::json!(["binaries/runner"])
        );
    }
}
