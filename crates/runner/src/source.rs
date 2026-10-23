//! Where the payload comes from: `--payload`, `BOT_INVENTOR_PAYLOAD`, or the end of this
//! executable, where an exported bot carries it (`docs/ARCHITECTURE.md` §9.4).

use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

use runtime::graph::{MAX_PAYLOAD_BYTES, PayloadError, read_container};

use crate::failure::Failure;

/// The bytes of the payload. `chosen` is the path from the command line, then from the
/// environment (`from_env`); with neither, the footer of the running executable is read.
///
/// # Errors
///
/// A [`Failure`] when the file cannot be read, is larger than a payload can be, or the footer
/// cannot be trusted; and a configuration one when there is no payload at all.
pub fn read(chosen: Option<&Path>, from_env: Option<&Path>) -> Result<Vec<u8>, Failure> {
    if let Some(path) = chosen.or(from_env) {
        return read_file(path);
    }
    let exe = std::env::current_exe()
        .and_then(File::open)
        .map_err(|_| Failure::other("cannot open the executable to look for the bot inside it"))?;
    embedded(exe)
}

/// The payload at the end of `file`, written by `write_container`.
///
/// # Errors
///
/// As [`read`].
pub fn embedded<R: Read + Seek>(mut file: R) -> Result<Vec<u8>, Failure> {
    match read_container(&mut file) {
        Ok(Some(payload)) => Ok(payload),
        Ok(None) => Err(Failure::config(
            "this runner has no bot inside it: give a payload with `--payload <file>` or \
             `BOT_INVENTOR_PAYLOAD`",
        )),
        Err(error) => Err(error.into()),
    }
}

fn read_file(path: &Path) -> Result<Vec<u8>, Failure> {
    let unreadable = |error: &std::io::Error| {
        Failure::config(format!(
            "cannot read the payload `{}`: {}",
            path.display(),
            error.kind()
        ))
    };
    let file = File::open(path).map_err(|error| unreadable(&error))?;
    let limit = u64::try_from(MAX_PAYLOAD_BYTES).unwrap_or(u64::MAX);
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| unreadable(&error))?;
    if bytes.len() as u64 > limit {
        return Err(PayloadError::TooLarge {
            limit: MAX_PAYLOAD_BYTES,
            when: "on disk",
        }
        .into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use runtime::graph::write_container;

    use super::*;

    #[test]
    fn a_missing_file_is_a_configuration_error() {
        let dir = tempfile::tempdir().unwrap();
        let failure = read(Some(&dir.path().join("none.bin")), None).unwrap_err();
        assert_eq!(failure.code(), 2);
        assert!(failure.message().contains("none.bin"));
    }

    #[test]
    fn the_command_line_wins_over_the_environment() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.bin");
        let b = dir.path().join("b.bin");
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(&b, b"b").unwrap();
        assert_eq!(read(Some(&a), Some(&b)).unwrap(), b"a");
        assert_eq!(read(None, Some(&b)).unwrap(), b"b");
    }

    #[test]
    fn a_file_larger_than_a_payload_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("big.bin");
        let file = File::create(&big).unwrap();
        file.set_len(u64::try_from(MAX_PAYLOAD_BYTES).unwrap() + 1)
            .unwrap();
        assert_eq!(read(Some(&big), None).unwrap_err().code(), 1);
    }

    #[test]
    fn the_footer_of_an_executable_is_found() {
        let mut exe = b"\x7fELF not really an executable".to_vec();
        write_container(&mut exe, b"the payload").unwrap();
        assert_eq!(embedded(Cursor::new(exe)).unwrap(), b"the payload");
    }

    #[test]
    fn an_executable_with_no_footer_says_what_to_do() {
        let failure = embedded(Cursor::new(b"just a program".to_vec())).unwrap_err();
        assert_eq!(failure.code(), 2);
        assert!(failure.message().contains("--payload"));
        assert_eq!(embedded(Cursor::new(Vec::new())).unwrap_err().code(), 2);
    }

    #[test]
    fn a_footer_that_cannot_be_trusted_is_refused() {
        let mut exe = b"program".to_vec();
        write_container(&mut exe, b"the payload").unwrap();
        let len = exe.len();
        // Make the length in the footer longer than the file.
        exe[len - 8..].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(embedded(Cursor::new(exe)).unwrap_err().code(), 1);
    }
}
