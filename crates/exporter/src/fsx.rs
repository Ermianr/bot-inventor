//! File system helpers: modes, the staging folder and the copy of one file.

use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DIR_MODE: u32 = 0o755;
pub const FILE_MODE: u32 = 0o644;
pub const EXECUTABLE_MODE: u32 = 0o755;

/// Creates a folder with exactly `mode` (the process mask does not change it).
pub fn create_dir(path: &Path, mode: u32) -> io::Result<()> {
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(mode);
    }
    builder.create(path)?;
    set_mode(path, mode)
}

/// Creates a new file (it must not exist) with exactly `mode`.
pub fn create_file(path: &Path, mode: u32) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(mode);
    }
    let file = options.open(path)?;
    set_mode(path, mode)?;
    Ok(file)
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

/// Copies at most `budget` bytes of `source` into a new file at `dest`, and returns how many.
/// A source that is not a regular file, or that holds more than the budget, is an error and
/// leaves no `dest` behind.
pub fn copy_file(source: &Path, dest: &Path, budget: u64) -> io::Result<u64> {
    let mut input = File::open(source)?;
    if !input.metadata()?.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file"));
    }
    let mut output = create_file(dest, FILE_MODE)?;
    let copied = io::copy(
        &mut (&mut input).take(budget.saturating_add(1)),
        &mut output,
    )
    .and_then(|copied| {
        if copied > budget {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "too large"));
        }
        output.flush()?;
        Ok(copied)
    });
    if copied.is_err() {
        let _ = fs::remove_file(dest);
    }
    copied
}

/// A folder inside the output where everything is written first. It is removed when dropped,
/// whether the export worked or not: after the moves it is empty.
pub struct Staging {
    path: PathBuf,
}

impl Staging {
    /// # Errors
    ///
    /// When the folder cannot be created in `out`.
    pub fn create(out: &Path) -> io::Result<Self> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let mut last = io::Error::from(io::ErrorKind::AlreadyExists);
        for attempt in 0_u32..8 {
            let path = out.join(format!(".export-{}-{nanos}-{attempt}", process::id()));
            match create_dir(&path, 0o700) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => last = error,
                Err(error) => return Err(error),
            }
        }
        Err(last)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
