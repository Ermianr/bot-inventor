//! The files of `assets/` that the nodes reference (`docs/ARCHITECTURE.md` §10): each must name
//! a file inside the assets folder, and exist.

use std::path::Path;

use runtime::compile::unsafe_asset_path;

use crate::failure::Failure;

/// Checks every asset of the payload.
///
/// # Errors
///
/// A configuration [`Failure`] naming the first asset whose path could leave the folder (a
/// payload that skipped compile may hold one), that is missing, that is not a file, or that
/// resolves outside the folder through a link.
pub fn check(assets: &[String], dir: &Path) -> Result<(), Failure> {
    if assets.is_empty() {
        return Ok(());
    }
    let root = dir.canonicalize().map_err(|_| {
        Failure::config(format!(
            "the assets folder `{}` is missing, and the bot needs `{}`",
            dir.display(),
            assets.first().map_or("", String::as_str)
        ))
    })?;
    for asset in assets {
        if let Some(reason) = unsafe_asset_path(asset) {
            return Err(Failure::config(format!(
                "the asset `{}` cannot be used: {reason}",
                shown(asset)
            )));
        }
        let missing = || {
            Failure::config(format!(
                "the asset `{asset}` is missing: put it in `{}`",
                dir.display()
            ))
        };
        let found = root.join(asset).canonicalize().map_err(|_| missing())?;
        if !found.starts_with(&root) {
            return Err(Failure::config(format!(
                "the asset `{asset}` is a link to a file outside `{}`",
                dir.display()
            )));
        }
        if !found.is_file() {
            return Err(missing());
        }
    }
    Ok(())
}

/// A path that failed the safety check is cut short and made printable.
fn shown(path: &str) -> String {
    path.chars()
        .take(60)
        .map(|c| if c.is_control() { '?' } else { c })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn assets(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn no_assets_need_no_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(check(&[], &dir.path().join("nothing")).is_ok());
    }

    #[test]
    fn an_existing_file_passes() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("img")).unwrap();
        fs::write(dir.path().join("img/a.png"), b"x").unwrap();
        fs::write(dir.path().join("b.txt"), b"x").unwrap();
        assert!(check(&assets(&["img/a.png", "b.txt"]), dir.path()).is_ok());
    }

    #[test]
    fn a_missing_file_or_folder_is_named() {
        let dir = tempfile::tempdir().unwrap();
        let failure = check(&assets(&["gone.png"]), dir.path()).unwrap_err();
        assert_eq!(failure.code(), 2);
        assert!(failure.message().contains("gone.png"));
        let failure = check(&assets(&["gone.png"]), &dir.path().join("nope")).unwrap_err();
        assert_eq!(failure.code(), 2);
        assert!(failure.message().contains("gone.png"));
        fs::create_dir(dir.path().join("folder")).unwrap();
        assert_eq!(
            check(&assets(&["folder"]), dir.path()).unwrap_err().code(),
            2
        );
    }

    #[test]
    fn a_path_that_leaves_the_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let assets_dir = dir.path().join("assets");
        fs::create_dir(&assets_dir).unwrap();
        fs::write(dir.path().join("secret.txt"), b"x").unwrap();
        for bad in [
            "../secret.txt",
            "/etc/passwd",
            "a/../../secret.txt",
            "",
            "a\\b",
            "c:/x",
            "./a",
            "a//b",
            "a\nb",
        ] {
            let failure = check(&assets(&[bad]), &assets_dir).unwrap_err();
            assert_eq!(failure.code(), 2, "{bad:?}");
            assert!(!failure.message().contains('\n'), "{bad:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let assets_dir = dir.path().join("assets");
        fs::create_dir(&assets_dir).unwrap();
        fs::write(dir.path().join("secret.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(dir.path().join("secret.txt"), assets_dir.join("link.txt"))
            .unwrap();
        let failure = check(&assets(&["link.txt"]), &assets_dir).unwrap_err();
        assert_eq!(failure.code(), 2);
        assert!(failure.message().contains("outside"));
    }
}
