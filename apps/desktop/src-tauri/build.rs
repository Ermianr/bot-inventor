/// Every command the frontend may call is listed here; a command that is not listed cannot be
/// called, even from the main window (`docs/DEVELOPMENT-GUIDE.md` §7).
const COMMANDS: &[&str] = &[
    "app_info",
    "new_project",
    "open_project",
    "save_project",
    "validate_project",
    "node_catalog",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("the Tauri build configuration is checked by the build itself");
}
