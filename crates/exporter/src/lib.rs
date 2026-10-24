//! Packaging for an exported bot (`docs/ARCHITECTURE.md` §9.4).
//!
//! [`export`] writes the folder of a bot: the executable (the runner, the payload and the
//! footer), a copy of the project's `assets/` and a `.env.example`. It never writes a `.env`,
//! a `data/` folder or a database: those belong to the machine where the bot runs, and a second
//! export into the same folder leaves them alone.
//!
//! The crate depends on `graph` and nothing else of the repository. It does not compile: the
//! caller gives it the [`Payload`] that `runtime::compile::compile` made, so a project with
//! errors never gets here.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::panic))]

mod assets;
mod error;
mod fsx;
mod name;

use std::fs::{self, File};
use std::io;
use std::path::{Component, Path, PathBuf};

pub use assets::{MAX_BYTES, MAX_DEPTH, MAX_ENTRIES};
pub use error::ExportError;
use graph::{Payload, read_container, write_container};
pub use name::{MAX_NAME_BYTES, check as check_name};

use crate::assets::Scan;
use crate::fsx::{DIR_MODE, EXECUTABLE_MODE, Staging};

/// The file that tells the user what goes in a `.env`.
pub const ENV_EXAMPLE: &str = ".env.example";

/// The text of [`ENV_EXAMPLE`]: no value, so it holds no secret.
const ENV_EXAMPLE_TEXT: &str = "\
# Copy this file to `.env`, next to the bot, and fill it in.
# Keep `.env` private: it holds the bot token. Do not share it or commit it.

# The bot token, from the Discord developer portal (Bot > Token).
DISCORD_TOKEN=

# Optional: a server id. The commands are then created only on that server, which is useful
# while testing.
# DISCORD_DEV_GUILD_ID=
";

/// What to export and where.
#[derive(Debug, Clone, Copy)]
pub struct Export<'a> {
    /// The `runner` executable, as built, with no bot inside it.
    pub runner: &'a Path,
    /// What `compile` made of the project.
    pub payload: &'a Payload,
    /// The project folder. Only its `assets/` is read.
    pub project: &'a Path,
    /// The folder to write. Its parent must exist; it is created if it does not.
    pub out: &'a Path,
    /// The name of the executable (see [`MAX_NAME_BYTES`]).
    pub name: &'a str,
}

/// What an export wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exported {
    pub executable: PathBuf,
    /// The number of files copied to `assets/`.
    pub assets: usize,
}

/// Writes the folder of the bot.
///
/// Everything is first written to a staging folder inside `out`, so an error before the end
/// leaves `out` as it was. The files are then moved into place with renames; the executable
/// replaces the old one without writing into it, so it works while the old one runs. A second
/// export replaces the executable, `.env.example` and the files of `assets/` the project has,
/// and touches nothing else.
///
/// # Errors
///
/// An [`ExportError`] for a bad name, a runner that is not a plain runner, an unsafe or missing
/// asset, an output that cannot be used, or an I/O failure.
pub fn export(request: &Export<'_>) -> Result<Exported, ExportError> {
    name::check(request.name)?;
    let payload = request.payload.encode()?;
    let mut runner = open_runner(request.runner)?;
    let assets_dir = request.project.join("assets");
    let out_existed = check_output(request.out, request.project, &assets_dir)?;
    let scan = assets::scan(&assets_dir)?;
    assets::require(&scan, &request.payload.requirements.assets)?;
    if out_existed {
        check_destinations(request.out, request.name, &scan)?;
    } else {
        fsx::create_dir(request.out, DIR_MODE)
            .map_err(|e| ExportError::io("create", request.out, &e))?;
    }

    let result = write(request, &mut runner, &payload, &scan);
    if result.is_err() && !out_existed {
        // Empty by now: the staging folder is gone.
        let _ = fs::remove_dir(request.out);
    }
    result
}

/// The runner, opened: a regular file with no bot inside it.
fn open_runner(path: &Path) -> Result<File, ExportError> {
    let bad = |reason| ExportError::Runner {
        path: path.to_path_buf(),
        reason,
    };
    let mut file = File::open(path).map_err(|e| ExportError::io("open", path, &e))?;
    let meta = file
        .metadata()
        .map_err(|e| ExportError::io("read", path, &e))?;
    if !meta.is_file() {
        return Err(bad("it is not a regular file"));
    }
    match read_container(&mut file) {
        Ok(None) => {}
        Ok(Some(_)) | Err(_) => return Err(bad("it already has a bot inside it")),
    }
    io::Seek::rewind(&mut file).map_err(|e| ExportError::io("read", path, &e))?;
    Ok(file)
}

/// Checks the output folder and says whether it already exists.
fn check_output(out: &Path, project: &Path, assets: &Path) -> Result<bool, ExportError> {
    let bad = |reason| ExportError::Output {
        path: out.to_path_buf(),
        reason,
    };
    let existed = match fs::symlink_metadata(out) {
        Ok(meta) if meta.is_symlink() => return Err(bad("it is a link")),
        Ok(meta) if !meta.is_dir() => return Err(bad("it is not a folder")),
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(ExportError::io("read", out, &error)),
    };

    let resolved = if existed {
        fs::canonicalize(out).map_err(|e| ExportError::io("read", out, &e))?
    } else {
        let Some(file_name) = out
            .file_name()
            .filter(|_| out.components().all(|c| !matches!(c, Component::ParentDir)))
        else {
            return Err(bad("it has no name of its own"));
        };
        let parent = match out.parent() {
            Some(p) if !p.as_os_str().is_empty() => p,
            _ => Path::new("."),
        };
        let parent = fs::canonicalize(parent).map_err(|e| ExportError::io("read", parent, &e))?;
        parent.join(file_name)
    };
    if fs::canonicalize(project).is_ok_and(|project| resolved == project) {
        return Err(ExportError::OutputIsProject {
            path: out.to_path_buf(),
        });
    }
    if fs::canonicalize(assets).is_ok_and(|assets| resolved.starts_with(assets)) {
        return Err(ExportError::OutputInsideAssets {
            path: out.to_path_buf(),
        });
    }
    Ok(existed)
}

/// Before anything is written: what is already in `out` must be something a move can replace.
fn check_destinations(out: &Path, name: &str, scan: &Scan) -> Result<(), ExportError> {
    let is_dir = |path: &Path| -> Result<Option<bool>, ExportError> {
        match fs::symlink_metadata(path) {
            Ok(meta) => Ok(Some(meta.is_dir())),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(ExportError::io("read", path, &e)),
        }
    };
    let conflict = |path: &Path| ExportError::Conflict {
        path: path.to_path_buf(),
    };
    // A file (or a link, which a move replaces) may be there; a folder may not.
    for file in [out.join(name), out.join(ENV_EXAMPLE)] {
        if is_dir(&file)? == Some(true) {
            return Err(conflict(&file));
        }
    }
    // The folders must be folders, and not links that lead out of `out`.
    let assets = out.join("assets");
    if is_dir(&assets)? == Some(false) {
        return Err(conflict(&assets));
    }
    for dir in &scan.dirs {
        let dest = assets.join(dir);
        if is_dir(&dest)? == Some(false) {
            return Err(conflict(&dest));
        }
    }
    for file in &scan.files {
        let dest = assets.join(&file.relative);
        if is_dir(&dest)? == Some(true) {
            return Err(conflict(&dest));
        }
    }
    Ok(())
}

fn write(
    request: &Export<'_>,
    runner: &mut File,
    payload: &[u8],
    scan: &Scan,
) -> Result<Exported, ExportError> {
    let out = request.out;
    let staging = Staging::create(out).map_err(|e| ExportError::io("create", out, &e))?;
    let stage = staging.path();

    // The executable: the runner, then the payload and its footer.
    let staged_exe = stage.join(request.name);
    {
        let mut file = fsx::create_file(&staged_exe, EXECUTABLE_MODE)
            .map_err(|e| ExportError::io("write", &staged_exe, &e))?;
        io::copy(runner, &mut file).map_err(|e| ExportError::io("write", &staged_exe, &e))?;
        write_container(&mut file, payload)?;
        file.sync_all()
            .map_err(|e| ExportError::io("write", &staged_exe, &e))?;
    }

    // The assets.
    let staged_assets = stage.join("assets");
    fsx::create_dir(&staged_assets, DIR_MODE)
        .map_err(|e| ExportError::io("create", &staged_assets, &e))?;
    for dir in &scan.dirs {
        let path = staged_assets.join(dir);
        fsx::create_dir(&path, DIR_MODE).map_err(|e| ExportError::io("create", &path, &e))?;
    }
    let mut budget = MAX_BYTES;
    for file in &scan.files {
        let dest = staged_assets.join(&file.relative);
        let copied = fsx::copy_file(&file.source, &dest, budget)
            .map_err(|e| ExportError::io("copy", &file.source, &e))?;
        budget = budget.saturating_sub(copied);
    }

    // The `.env.example`.
    let staged_example = stage.join(ENV_EXAMPLE);
    {
        use std::io::Write;
        let mut file = fsx::create_file(&staged_example, fsx::FILE_MODE)
            .map_err(|e| ExportError::io("write", &staged_example, &e))?;
        file.write_all(ENV_EXAMPLE_TEXT.as_bytes())
            .map_err(|e| ExportError::io("write", &staged_example, &e))?;
    }

    // Into place. The executable goes last: a bot that is half moved is not runnable.
    let final_assets = out.join("assets");
    if !final_assets.exists() {
        fsx::create_dir(&final_assets, DIR_MODE)
            .map_err(|e| ExportError::io("create", &final_assets, &e))?;
    }
    for dir in &scan.dirs {
        let path = final_assets.join(dir);
        if !path.exists() {
            fsx::create_dir(&path, DIR_MODE).map_err(|e| ExportError::io("create", &path, &e))?;
        }
    }
    for file in &scan.files {
        let to = final_assets.join(&file.relative);
        fs::rename(staged_assets.join(&file.relative), &to)
            .map_err(|e| ExportError::io("move", &to, &e))?;
    }
    let example = out.join(ENV_EXAMPLE);
    fs::rename(&staged_example, &example).map_err(|e| ExportError::io("move", &example, &e))?;
    let executable = out.join(request.name);
    fs::rename(&staged_exe, &executable).map_err(|e| ExportError::io("move", &executable, &e))?;

    Ok(Exported {
        executable,
        assets: scan.files.len(),
    })
}
