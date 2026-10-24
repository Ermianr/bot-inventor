//! What can go wrong while exporting. A message names a path or a setting and never a value
//! that could be a secret.

use std::io;
use std::path::PathBuf;

use graph::PayloadError;

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("the bot name {reason}")]
    InvalidName { reason: &'static str },
    #[error("the payload cannot be written: {0}")]
    Payload(#[from] PayloadError),
    #[error("the runner `{}` cannot be used: {reason}", path.display())]
    Runner { path: PathBuf, reason: &'static str },
    #[error("the output `{}` cannot be used: {reason}", path.display())]
    Output { path: PathBuf, reason: &'static str },
    #[error("the output `{}` is the project folder itself", path.display())]
    OutputIsProject { path: PathBuf },
    #[error("the output `{}` is inside the project's `assets/`, which it would copy into itself", path.display())]
    OutputInsideAssets { path: PathBuf },
    #[error("`assets/{}` cannot be exported: {reason}", path.display())]
    Asset { path: PathBuf, reason: &'static str },
    #[error("`assets/` has more than {limit} {what}")]
    AssetsTooLarge { what: &'static str, limit: u64 },
    #[error("the bot uses `assets/{name}`, which the project does not have")]
    MissingAsset { name: String },
    #[error("`{}` is in the way: it is not what the export would put there", path.display())]
    Conflict { path: PathBuf },
    #[error("cannot {action} `{}`: {kind}", path.display())]
    Io {
        action: &'static str,
        path: PathBuf,
        kind: io::ErrorKind,
    },
}

impl ExportError {
    pub(crate) fn io(action: &'static str, path: impl Into<PathBuf>, error: &io::Error) -> Self {
        Self::Io {
            action,
            path: path.into(),
            kind: error.kind(),
        }
    }
}
