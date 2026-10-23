//! The data folder and the database in it (`docs/ARCHITECTURE.md` §8).

use std::fs;
use std::path::Path;

use storage_sqlite::SqliteStorage;

use crate::failure::Failure;

/// The name of the database inside the data folder.
pub const DATABASE: &str = "bot.sqlite";

/// Opens the database in `dir`, creating the folder (mode 0700) and the file (mode 0600, by the
/// storage) when they are not there.
///
/// # Errors
///
/// A [`Failure`] when the folder cannot be made, or the database is refused (a newer one, one
/// of another program, a link where the file should be).
pub fn open(dir: &Path) -> Result<SqliteStorage, Failure> {
    create_dir(dir)?;
    Ok(SqliteStorage::open(&dir.join(DATABASE))?)
}

fn create_dir(dir: &Path) -> Result<(), Failure> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir).map_err(|error| {
        Failure::config(format!(
            "cannot create the data folder `{}`: {}",
            dir.display(),
            error.kind()
        ))
    })?;
    if dir.is_dir() {
        Ok(())
    } else {
        Err(Failure::config(format!(
            "the data path `{}` is not a folder",
            dir.display()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn the_folder_is_private_and_the_database_is_made() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("nested/data");
        let storage = open(&dir).unwrap();
        drop(storage);
        let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&dir.join(DATABASE)), 0o600);
    }

    #[test]
    fn a_file_where_the_folder_should_be_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("data");
        fs::write(&path, b"x").unwrap();
        assert_eq!(open(&path).err().unwrap().code(), 2);
    }

    #[test]
    fn a_database_of_another_program_is_refused() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join(DATABASE),
            b"not a database at all, just text",
        )
        .unwrap();
        assert!(open(root.path()).is_err());
    }
}
