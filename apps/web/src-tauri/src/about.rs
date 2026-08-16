use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// What the user is running, for the moment something goes wrong and somebody
/// asks them.
///
/// Only what this side knows is here. The name of the application, its licence
/// and where its repository is are the same in every build and are written in
/// the editor; the version and the Node.js underneath a Session are not, and
/// this is the only place either can be read from.

/// The application, as Help ▸ About reads it out.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    /// The version of Bot Inventor itself, as packaging stamped it.
    version: String,
    /// The Node.js the sidecar actually is, or nothing when it cannot say.
    ///
    /// It is asked rather than assumed: the pinned version in the build script
    /// is what a sidecar is downloaded for, and the point of showing it is that
    /// it is the truth about the machine the user is on.
    node_version: Option<String>,
}

#[tauri::command]
pub async fn describe_application(app: AppHandle) -> Application {
    Application {
        version: app.package_info().version.to_string(),
        node_version: node_version(&app).await,
    }
}

/// The sidecar's own answer to `node --version`, without the `v` it prints in
/// front of it.
///
/// A sidecar that is missing or will not run is not worth failing About over:
/// the dialog exists to say what can be said, and it says so when this is one
/// of the things it cannot.
async fn node_version(app: &AppHandle) -> Option<String> {
    let reported = app
        .shell()
        .sidecar("node")
        .ok()?
        .args(["--version"])
        .output()
        .await
        .ok()?;

    if !reported.status.success() {
        return None;
    }

    let version = String::from_utf8_lossy(&reported.stdout)
        .trim()
        .trim_start_matches('v')
        .to_string();

    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}
