//! The errors of loading and saving a project.

use std::path::PathBuf;

use crate::names::NameError;

/// Why a project could not be loaded or saved. Every variant names the file, and a
/// parse error carries the line and column that `serde_json` reports.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ProjectError {
    #[error("cannot access {}: {source}", path.display())]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("{} not found; it is not a Bot Inventor project", path.display())]
    MissingManifest { path: PathBuf },

    #[error("{} is a symbolic link; links inside a project are not followed", path.display())]
    Symlink { path: PathBuf },

    #[error("{} is not a regular file", path.display())]
    NotAFile { path: PathBuf },

    #[error("{} is not a folder", path.display())]
    NotAFolder { path: PathBuf },

    #[error("{} is larger than {limit} bytes", path.display())]
    TooLarge { path: PathBuf, limit: u64 },

    #[error("the project has {count} flows; the most allowed is {limit}")]
    TooManyFlows { count: usize, limit: usize },

    #[error("{} is not valid UTF-8", path.display())]
    NotUtf8 { path: PathBuf },

    #[error("{}: {source}", path.display())]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },

    #[error("{}: `format_version` must be an integer of 1 or more", path.display())]
    InvalidVersion { path: PathBuf },

    #[error(
        "{} has format_version {found}, but this version of Bot Inventor supports up to \
         {supported}; update Bot Inventor to open it",
        path.display()
    )]
    NewerFormat {
        path: PathBuf,
        found: u32,
        supported: u32,
    },

    #[error("{}: {source}", path.display())]
    InvalidFlowFileName { path: PathBuf, source: NameError },

    #[error("flow `{flow}`, node `{node}`: the editor position must be a finite number")]
    NonFinitePosition { flow: String, node: String },

    #[error("the manifest has format_version {found}; only {supported} can be saved")]
    UnsavableVersion { found: u32, supported: u32 },
}
