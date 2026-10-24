//! The commands of the editor: create, open and save a project, read the node catalog and
//! validate a project.
//!
//! The folder of the open project is chosen with a native dialog and stays here, in Rust: the
//! webview never names a path, so it cannot make the app write anywhere else. Everything the
//! webview sends is checked again here (`docs/DEVELOPMENT-GUIDE.md` §7).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use graph::{Flow, FlowName, Manifest, Project, ProjectError};
use runtime::catalog::{NodeSpec, Registry};
use runtime::compile::{self, Diagnostic, Severity};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// The flow a new project starts with.
const FIRST_FLOW: &str = "main";
/// The longest project name, in characters.
const MAX_PROJECT_NAME: usize = 64;

/// Why a command failed. The message is for the person using the app and names no secret.
#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum EditorError {
    /// The webview sent something that is not valid.
    #[error("{0}")]
    InvalidInput(String),
    /// The folder is not a project, or the project could not be read or written.
    #[error("{0}")]
    Project(String),
    /// A command needs an open project and there is none.
    #[error("no project is open")]
    NoProject,
}

impl From<ProjectError> for EditorError {
    fn from(error: ProjectError) -> Self {
        Self::Project(error.to_string())
    }
}

/// The folder of the open project.
#[derive(Debug, Default)]
pub struct EditorState {
    folder: Mutex<Option<PathBuf>>,
}

impl EditorState {
    fn set(&self, folder: PathBuf) {
        *self.folder.lock().unwrap_or_else(|e| e.into_inner()) = Some(folder);
    }

    fn get(&self) -> Option<PathBuf> {
        self.folder
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

/// A project the editor has just opened or created.
#[derive(Debug, Serialize, Type)]
pub struct OpenedProject {
    pub project: Project,
    /// The format version the project was written in, when it was older than the current one.
    pub migrated_from: Option<u32>,
}

/// One finding of compile, ready for the editor to mark the field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct DiagnosticView {
    pub flow: Option<String>,
    pub node: Option<String>,
    pub path: Option<String>,
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

impl From<&Diagnostic> for DiagnosticView {
    fn from(diagnostic: &Diagnostic) -> Self {
        Self {
            flow: diagnostic.flow.as_ref().map(ToString::to_string),
            node: diagnostic.node.as_ref().map(ToString::to_string),
            path: diagnostic.path.clone(),
            code: diagnostic.code.as_str().to_owned(),
            severity: match diagnostic.severity() {
                Severity::Error => DiagnosticSeverity::Error,
                Severity::Warning => DiagnosticSeverity::Warning,
            },
            message: diagnostic.message.clone(),
        }
    }
}

/// Checks the name of a project: 1 to 64 characters, none a control character.
fn check_project_name(name: &str) -> Result<(), EditorError> {
    let length = name.chars().count();
    if name.trim().is_empty() || length > MAX_PROJECT_NAME {
        return Err(EditorError::InvalidInput(format!(
            "the project name must have 1 to {MAX_PROJECT_NAME} characters"
        )));
    }
    if name.chars().any(char::is_control) {
        return Err(EditorError::InvalidInput(
            "the project name cannot have control characters".to_owned(),
        ));
    }
    Ok(())
}

/// Creates an empty project in `folder`, which must exist and be empty.
pub fn create_in(folder: &Path, name: &str) -> Result<OpenedProject, EditorError> {
    check_project_name(name)?;
    let mut entries = fs::read_dir(folder).map_err(|source| {
        EditorError::Project(format!("cannot read {}: {source}", folder.display()))
    })?;
    if entries.next().is_some() {
        return Err(EditorError::InvalidInput(
            "choose an empty folder for a new project".to_owned(),
        ));
    }
    let first =
        FlowName::parse(FIRST_FLOW).map_err(|e| EditorError::InvalidInput(e.to_string()))?;
    let project = Project {
        manifest: Manifest::new(name),
        flows: [(first, Flow::default())].into_iter().collect(),
    };
    project.save(folder)?;
    Ok(OpenedProject {
        project,
        migrated_from: None,
    })
}

/// Reads the project in `folder`.
pub fn open_in(folder: &Path) -> Result<OpenedProject, EditorError> {
    let loaded = Project::load(folder)?;
    Ok(OpenedProject {
        project: loaded.project,
        migrated_from: loaded.migrated_from,
    })
}

/// Writes `project` to `folder` after checking what the webview sent.
pub fn save_in(folder: &Path, project: &Project) -> Result<(), EditorError> {
    check_project_name(&project.manifest.name)?;
    project.save(folder)?;
    Ok(())
}

/// Compiles `project` and returns what it found, in the order compile gives.
#[must_use]
pub fn validate(project: &Project) -> Vec<DiagnosticView> {
    let report = compile::compile(project, env!("CARGO_PKG_VERSION"));
    report
        .diagnostics
        .iter()
        .map(DiagnosticView::from)
        .collect()
}

/// Shows the folder dialog and waits; `None` when the person cancels.
async fn pick_folder(app: &AppHandle) -> Result<Option<PathBuf>, EditorError> {
    let app = app.clone();
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| EditorError::Project("the folder dialog stopped".to_owned()))?;
    picked
        .map(|path| {
            path.into_path()
                .map_err(|_| EditorError::InvalidInput("the folder is not a local path".to_owned()))
        })
        .transpose()
}

/// Asks for an empty folder and creates a project in it.
#[tauri::command]
#[specta::specta]
pub async fn new_project(
    app: AppHandle,
    state: State<'_, EditorState>,
    name: String,
) -> Result<Option<OpenedProject>, EditorError> {
    check_project_name(&name)?;
    let Some(folder) = pick_folder(&app).await? else {
        return Ok(None);
    };
    let opened = create_in(&folder, &name)?;
    state.set(folder);
    Ok(Some(opened))
}

/// Asks for a project folder and opens it.
#[tauri::command]
#[specta::specta]
pub async fn open_project(
    app: AppHandle,
    state: State<'_, EditorState>,
) -> Result<Option<OpenedProject>, EditorError> {
    let Some(folder) = pick_folder(&app).await? else {
        return Ok(None);
    };
    let opened = open_in(&folder)?;
    state.set(folder);
    Ok(Some(opened))
}

/// Saves the project to the folder that was opened or created.
#[tauri::command]
#[specta::specta]
pub async fn save_project(
    state: State<'_, EditorState>,
    project: Project,
) -> Result<(), EditorError> {
    let folder = state.get().ok_or(EditorError::NoProject)?;
    save_in(&folder, &project)
}

/// Compiles the project the editor holds and returns its diagnostics.
#[tauri::command]
#[specta::specta]
pub async fn validate_project(project: Project) -> Vec<DiagnosticView> {
    validate(&project)
}

/// The schema of every node type, for the palette and the property panel.
#[tauri::command]
#[specta::specta]
pub fn node_catalog() -> Vec<&'static NodeSpec> {
    Registry::builtin().specs().collect()
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    const PING: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../crates/graph/tests/samples/v1/ping"
    );

    fn ping() -> Project {
        open_in(Path::new(PING))
            .expect("the ping sample opens")
            .project
    }

    fn read(dir: &Path, file: &str) -> String {
        fs::read_to_string(dir.join(file)).expect("the file exists")
    }

    #[test]
    fn ping_saves_back_to_the_same_bytes() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        save_in(dir.path(), &ping()).expect("it saves");
        for file in ["bot.botproj", "flows/ping.flow.json"] {
            assert_eq!(
                read(dir.path(), file),
                read(Path::new(PING), file),
                "{file}"
            );
        }
    }

    #[test]
    fn a_new_project_has_one_empty_flow_and_opens_again() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let created = create_in(dir.path(), "My bot").expect("it is created");
        assert_eq!(created.project.manifest.name, "My bot");
        assert_eq!(created.project.flows.len(), 1);
        let reopened = open_in(dir.path()).expect("it opens");
        assert_eq!(reopened.project, created.project);
    }

    #[test]
    fn a_new_project_needs_an_empty_folder() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        fs::write(dir.path().join("notes.txt"), "mine").expect("a file");
        assert!(matches!(
            create_in(dir.path(), "bot"),
            Err(EditorError::InvalidInput(_))
        ));
        assert_eq!(read(dir.path(), "notes.txt"), "mine");
        assert!(!dir.path().join("bot.botproj").exists());
        assert!(create_in(&dir.path().join("missing"), "bot").is_err());
    }

    #[test]
    fn project_names_are_checked() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let long = "a".repeat(MAX_PROJECT_NAME + 1);
        for name in ["", "   ", "line\nbreak", "tab\there", long.as_str()] {
            assert!(
                matches!(
                    create_in(dir.path(), name),
                    Err(EditorError::InvalidInput(_))
                ),
                "{name:?}"
            );
            assert!(matches!(
                save_in(
                    dir.path(),
                    &Project {
                        manifest: Manifest::new(name),
                        flows: Default::default(),
                    }
                ),
                Err(EditorError::InvalidInput(_))
            ));
        }
        assert_eq!(fs::read_dir(dir.path()).expect("it lists").count(), 0);
        create_in(dir.path(), &"a".repeat(MAX_PROJECT_NAME)).expect("the longest name is fine");
    }

    #[test]
    fn opening_what_is_not_a_project_is_an_error() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let root = dir.path();

        let empty = root.join("empty");
        fs::create_dir(&empty).expect("a folder");
        let damaged = root.join("damaged");
        fs::create_dir(&damaged).expect("a folder");
        fs::write(damaged.join("bot.botproj"), "{ not json").expect("a file");
        let newer = root.join("newer");
        fs::create_dir(&newer).expect("a folder");
        fs::write(
            newer.join("bot.botproj"),
            r#"{"format_version": 99, "name": "x"}"#,
        )
        .expect("a file");
        let linked = root.join("linked");
        fs::create_dir(&linked).expect("a folder");
        symlink(
            Path::new(PING).join("bot.botproj"),
            linked.join("bot.botproj"),
        )
        .expect("a link");
        let file = root.join("file.txt");
        fs::write(&file, "text").expect("a file");

        for folder in [root.join("missing"), empty, damaged, newer, linked, file] {
            assert!(
                matches!(open_in(&folder), Err(EditorError::Project(_))),
                "{}",
                folder.display()
            );
        }
    }

    #[test]
    fn a_newer_project_says_to_update() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        fs::write(
            dir.path().join("bot.botproj"),
            r#"{"format_version": 99, "name": "x", "platform": "discord", "settings": {}, "variables": []}"#,
        )
        .expect("a file");
        let error = open_in(dir.path()).expect_err("a newer project must not open");
        assert!(error.to_string().contains("update"), "{error}");
    }

    #[test]
    fn saving_what_the_project_format_refuses_writes_nothing() {
        let dir = tempfile::tempdir().expect("a temporary folder");

        let mut moved = ping();
        for flow in moved.flows.values_mut() {
            for node in &mut flow.nodes {
                node.editor.x = f64::NAN;
            }
        }
        assert!(matches!(
            save_in(dir.path(), &moved),
            Err(EditorError::Project(_))
        ));

        let mut old = ping();
        old.manifest.format_version = 2;
        assert!(matches!(
            save_in(dir.path(), &old),
            Err(EditorError::Project(_))
        ));

        assert_eq!(fs::read_dir(dir.path()).expect("it lists").count(), 0);
    }

    #[test]
    fn the_webview_cannot_send_what_the_format_refuses() {
        // A project that comes over IPC goes through the same name checks as a file.
        let bad_flow = r#"{"manifest": {"format_version": 1, "name": "x", "platform": "discord",
            "settings": {}, "variables": []}, "flows": {"Bad Name": {"nodes": [], "lines": []}}}"#;
        assert!(serde_json::from_str::<Project>(bad_flow).is_err());
        let unknown = r#"{"manifest": {"format_version": 1, "name": "x", "platform": "discord",
            "settings": {}, "variables": []}, "flows": {}, "extra": 1}"#;
        assert!(serde_json::from_str::<Project>(unknown).is_err());
    }

    #[test]
    fn saving_needs_an_open_project() {
        let state = EditorState::default();
        assert!(state.get().is_none());
        state.set(PathBuf::from("/somewhere"));
        assert_eq!(state.get(), Some(PathBuf::from("/somewhere")));
    }

    #[test]
    fn ping_has_no_diagnostics_and_a_broken_flow_marks_the_field() {
        assert!(validate(&ping()).is_empty());

        let mut broken = ping();
        for flow in broken.flows.values_mut() {
            for node in &mut flow.nodes {
                if node.kind == "discord.reply" {
                    node.settings.remove("content");
                }
            }
        }
        let diagnostics = validate(&broken);
        assert!(!diagnostics.is_empty());
        let found = diagnostics
            .iter()
            .find(|d| d.path.as_deref() == Some("content"))
            .expect("the missing content is marked");
        assert_eq!(found.severity, DiagnosticSeverity::Error);
        assert_eq!(found.flow.as_deref(), Some("ping"));
        assert!(found.node.is_some());
    }

    #[test]
    fn the_catalog_lists_every_node_in_a_fixed_order() {
        let types: Vec<_> = node_catalog().iter().map(|spec| spec.type_id).collect();
        assert_eq!(
            types,
            [
                "data.set_variable",
                "discord.reply",
                "discord.slash_command",
                "logic.branch"
            ]
        );
    }
}
