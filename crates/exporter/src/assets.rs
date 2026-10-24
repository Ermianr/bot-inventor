//! The `assets/` folder of the project: what is in it, whether it is safe to copy, and the
//! assets a payload needs.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::ExportError;

/// Files and folders together.
pub const MAX_ENTRIES: usize = 4096;
/// Levels of folders under `assets/`.
pub const MAX_DEPTH: usize = 16;
/// The sum of the sizes of the files.
pub const MAX_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub struct AssetFile {
    /// The path under `assets/`.
    pub relative: PathBuf,
    pub source: PathBuf,
}

/// The contents of `assets/`, folders before the folders and files they hold.
#[derive(Debug, Default)]
pub struct Scan {
    pub dirs: Vec<PathBuf>,
    pub files: Vec<AssetFile>,
}

/// Lists `assets/`. A project with no `assets/` has nothing to copy. Only regular files and
/// folders are accepted and nothing is followed: a link, a socket or a device is an error.
///
/// # Errors
///
/// [`ExportError`] for a file of another kind, a name that is not text, a tree past the limits
/// above, or a folder that cannot be read.
pub fn scan(assets: &Path) -> Result<Scan, ExportError> {
    let mut scan = Scan::default();
    match fs::symlink_metadata(assets) {
        Ok(meta) if meta.is_dir() => {}
        Ok(meta) if meta.is_symlink() => {
            return Err(ExportError::Asset {
                path: PathBuf::new(),
                reason: "`assets` is a link",
            });
        }
        Ok(_) => {
            return Err(ExportError::Asset {
                path: PathBuf::new(),
                reason: "`assets` is not a folder",
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(scan),
        Err(error) => return Err(ExportError::io("read", assets, &error)),
    }

    let mut entries = 0_usize;
    let mut bytes = 0_u64;
    let mut pending = vec![(assets.to_path_buf(), PathBuf::new(), 0_usize)];
    while let Some((dir, relative, depth)) = pending.pop() {
        let read = fs::read_dir(&dir).map_err(|e| ExportError::io("read", &dir, &e))?;
        let mut children = Vec::new();
        for entry in read {
            let entry = entry.map_err(|e| ExportError::io("read", &dir, &e))?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| ExportError::Asset {
                    path: relative.join(entry.file_name()),
                    reason: "its name is not text",
                })?;
            children.push(name);
        }
        children.sort();
        // Pushed in reverse so the stack gives them back in order.
        let mut subdirs = Vec::new();
        for name in children {
            let rel = relative.join(&name);
            let source = dir.join(&name);
            let meta =
                fs::symlink_metadata(&source).map_err(|e| ExportError::io("read", &source, &e))?;
            entries += 1;
            if entries > MAX_ENTRIES {
                return Err(ExportError::AssetsTooLarge {
                    what: "files and folders",
                    limit: MAX_ENTRIES as u64,
                });
            }
            if meta.is_dir() {
                if depth + 1 > MAX_DEPTH {
                    return Err(ExportError::AssetsTooLarge {
                        what: "levels of folders",
                        limit: MAX_DEPTH as u64,
                    });
                }
                scan.dirs.push(rel.clone());
                subdirs.push((source, rel, depth + 1));
            } else if meta.is_file() {
                bytes = bytes.saturating_add(meta.len());
                if bytes > MAX_BYTES {
                    return Err(ExportError::AssetsTooLarge {
                        what: "bytes",
                        limit: MAX_BYTES,
                    });
                }
                scan.files.push(AssetFile {
                    relative: rel,
                    source,
                });
            } else {
                return Err(ExportError::Asset {
                    path: rel,
                    reason: if meta.is_symlink() {
                        "it is a link"
                    } else {
                        "it is neither a file nor a folder"
                    },
                });
            }
        }
        pending.extend(subdirs.into_iter().rev());
    }
    Ok(scan)
}

/// Checks that every asset the payload names is a file of the scan.
///
/// # Errors
///
/// [`ExportError::MissingAsset`] with the first name (in the order of the payload) that is not.
pub fn require(scan: &Scan, names: &[String]) -> Result<(), ExportError> {
    let present: HashSet<String> = scan
        .files
        .iter()
        .map(|f| {
            f.relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/")
        })
        .collect();
    match names.iter().find(|name| !present.contains(name.as_str())) {
        Some(name) => Err(ExportError::MissingAsset { name: name.clone() }),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(files: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for file in files {
            let path = dir.path().join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"x").unwrap();
        }
        dir
    }

    #[test]
    fn a_missing_folder_has_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let scan = scan(&dir.path().join("assets")).unwrap();
        assert!(scan.dirs.is_empty() && scan.files.is_empty());
    }

    #[test]
    fn files_and_folders_are_listed_in_order() {
        let dir = tree(&["b.png", "a/z.txt", "a/b/c.txt"]);
        let scan = scan(dir.path()).unwrap();
        let dirs: Vec<_> = scan.dirs.iter().map(|d| d.to_str().unwrap()).collect();
        assert_eq!(dirs, ["a", "a/b"]);
        let mut files: Vec<_> = scan
            .files
            .iter()
            .map(|f| f.relative.to_str().unwrap().to_owned())
            .collect();
        files.sort();
        assert_eq!(files, ["a/b/c.txt", "a/z.txt", "b.png"]);
    }

    #[test]
    fn a_link_is_refused_and_not_followed() {
        let outside = tree(&["secret"]);
        let dir = tree(&["ok.png"]);
        std::os::unix::fs::symlink(outside.path().join("secret"), dir.path().join("l")).unwrap();
        let error = scan(dir.path()).unwrap_err();
        assert!(matches!(error, ExportError::Asset { .. }), "{error}");
        assert!(error.to_string().contains("assets/l"), "{error}");

        let dir = tree(&["ok.png"]);
        std::os::unix::fs::symlink(outside.path(), dir.path().join("d")).unwrap();
        assert!(matches!(scan(dir.path()), Err(ExportError::Asset { .. })));
    }

    #[test]
    fn the_folder_itself_as_a_link_or_a_file_is_refused() {
        let real = tree(&["a"]);
        let holder = tempfile::tempdir().unwrap();
        let link = holder.path().join("assets");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        assert!(matches!(scan(&link), Err(ExportError::Asset { .. })));
        let file = holder.path().join("file");
        fs::write(&file, b"x").unwrap();
        assert!(matches!(scan(&file), Err(ExportError::Asset { .. })));
    }

    #[test]
    fn a_socket_or_a_pipe_is_refused() {
        let dir = tree(&["ok"]);
        let socket = std::os::unix::net::UnixListener::bind(dir.path().join("s")).unwrap();
        assert!(matches!(scan(dir.path()), Err(ExportError::Asset { .. })));
        drop(socket);
    }

    #[test]
    fn the_limit_of_levels_is_at_sixteen() {
        let at = ["d"; MAX_DEPTH].join("/");
        let dir = tree(&[&format!("{at}/f")]);
        assert!(scan(dir.path()).is_ok());
        let over = ["d"; MAX_DEPTH + 1].join("/");
        let dir = tree(&[&format!("{over}/f")]);
        assert!(matches!(
            scan(dir.path()),
            Err(ExportError::AssetsTooLarge { .. })
        ));
    }

    #[test]
    fn the_limit_of_entries_is_at_4096() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..MAX_ENTRIES {
            fs::write(dir.path().join(format!("f{n}")), b"").unwrap();
        }
        assert_eq!(scan(dir.path()).unwrap().files.len(), MAX_ENTRIES);
        fs::write(dir.path().join("one-more"), b"").unwrap();
        assert!(matches!(
            scan(dir.path()),
            Err(ExportError::AssetsTooLarge { .. })
        ));
    }

    #[test]
    fn the_limit_of_bytes_is_at_256_mib() {
        let dir = tempfile::tempdir().unwrap();
        // Sparse files: they cost no disk.
        let big = fs::File::create(dir.path().join("big")).unwrap();
        big.set_len(MAX_BYTES).unwrap();
        assert!(scan(dir.path()).is_ok());
        let one = fs::File::create(dir.path().join("one")).unwrap();
        one.set_len(1).unwrap();
        assert!(matches!(
            scan(dir.path()),
            Err(ExportError::AssetsTooLarge { .. })
        ));
    }

    #[test]
    fn a_name_that_is_not_text_is_refused() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let dir = tree(&["ok"]);
        fs::write(dir.path().join(OsStr::from_bytes(b"bad\xff")), b"x").unwrap();
        assert!(matches!(scan(dir.path()), Err(ExportError::Asset { .. })));
    }

    #[test]
    fn required_assets_are_found_by_their_path_with_slashes() {
        let dir = tree(&["logo.png", "img/a.png"]);
        let scan = scan(dir.path()).unwrap();
        assert!(require(&scan, &["logo.png".into(), "img/a.png".into()]).is_ok());
        let error = require(&scan, &["logo.png".into(), "nope.png".into()]).unwrap_err();
        assert!(error.to_string().contains("nope.png"));
        // A folder is not an asset, and a path out of `assets/` is never found.
        assert!(require(&scan, &["img".into()]).is_err());
        assert!(require(&scan, &["../x".into()]).is_err());
    }
}
