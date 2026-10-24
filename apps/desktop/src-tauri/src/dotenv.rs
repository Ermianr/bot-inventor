//! The project's `.env`: where the bot token and the development server are written.
//!
//! The token goes from the webview to this file and no further: nothing here returns it, prints
//! it or puts it in an error, and [`Token`] hides it from `Debug`. The runner reads the file
//! itself (`docs/ARCHITECTURE.md` §9.1).

use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::run::RunError;

pub const TOKEN_KEY: &str = "DISCORD_TOKEN";
pub const DEV_GUILD_KEY: &str = "DISCORD_DEV_GUILD_ID";
const ENV_FILE: &str = ".env";
/// More than this in a `.env` is not a `.env` (the runner reads at most the same).
const MAX_BYTES: u64 = 64 * 1024;
const MAX_TOKEN_CHARS: usize = 256;
/// A Discord id has at most 20 digits.
const MAX_ID_DIGITS: usize = 20;
const MODE: u32 = 0o600;

/// A bot token as it arrives from the webview. It is checked by [`Token::check`] before it is
/// written, and `Debug` shows nothing of it.
#[derive(Clone, Deserialize, Type)]
#[serde(transparent)]
pub struct Token(String);

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Token([redacted])")
    }
}

impl Token {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Accepts 1 to 256 of `A-Z a-z 0-9 . _ -`, which is what a Discord token is made of, so
    /// no space, `=`, quote, `#` or line break can add a line or change another.
    fn check(&self) -> Result<&str, RunError> {
        let valid = !self.0.is_empty()
            && self.0.chars().count() <= MAX_TOKEN_CHARS
            && self
                .0
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        if valid {
            Ok(&self.0)
        } else {
            Err(RunError::InvalidInput(format!(
                "the token must have 1 to {MAX_TOKEN_CHARS} letters, digits, dots, dashes or underscores"
            )))
        }
    }
}

/// What the webview may know about the file: whether a token is set, never the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct RunSettings {
    pub token_set: bool,
    /// The development server id, which is not a secret.
    pub dev_guild: Option<String>,
}

/// The lines of the file, read with the checks of a file that may hold a secret.
fn read_lines(folder: &Path) -> Result<Vec<String>, RunError> {
    let path = folder.join(ENV_FILE);
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error("read", &error)),
    };
    if !meta.file_type().is_file() {
        return Err(RunError::Files(
            "`.env` is a link or not a regular file".to_owned(),
        ));
    }
    let mut text = String::new();
    fs::File::open(&path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_string(&mut text))
        .map_err(|error| io_error("read", &error))?;
    if text.len() as u64 > MAX_BYTES {
        return Err(RunError::Files("`.env` is too large".to_owned()));
    }
    Ok(text.lines().map(str::to_owned).collect())
}

/// The messages name the operation and the kind of failure, never a line of the file.
fn io_error(action: &str, error: &std::io::Error) -> RunError {
    RunError::Files(format!("cannot {action} `.env` ({})", error.kind()))
}

/// The key of a `KEY=VALUE` line, when it is one.
fn split(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    if line.starts_with('#') {
        return None;
    }
    let (key, value) = line.split_once('=')?;
    Some((key.trim(), value.trim()))
}

fn is_id(text: &str) -> bool {
    (1..=MAX_ID_DIGITS).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit())
}

fn unquoted(value: &str) -> &str {
    ["\"", "'"]
        .iter()
        .find_map(|quote| value.strip_prefix(quote)?.strip_suffix(quote))
        .unwrap_or(value)
}

/// Replaces the lines of `key` with one `key=value` line (or none, for `None`), keeping every
/// other line as it is.
fn with_key(lines: &[String], key: &str, value: Option<&str>) -> Vec<String> {
    let mut out = Vec::with_capacity(lines.len() + 1);
    let mut placed = false;
    for line in lines {
        if split(line).is_some_and(|(k, _)| k == key) {
            if let (false, Some(value)) = (placed, value) {
                out.push(format!("{key}={value}"));
                placed = true;
            }
        } else {
            out.push(line.clone());
        }
    }
    if let (false, Some(value)) = (placed, value) {
        out.push(format!("{key}={value}"));
    }
    out
}

/// Writes the lines through a temporary file in the same folder and a rename, with mode 0600
/// whatever the old file had.
fn write_lines(folder: &Path, lines: &[String]) -> Result<(), RunError> {
    let mut text = lines.join("\n");
    if !text.is_empty() {
        text.push('\n');
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(folder).map_err(|error| io_error("write", &error))?;
    let written = temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(MODE))
        .and_then(|()| temporary.write_all(text.as_bytes()))
        .and_then(|()| temporary.as_file().sync_all());
    written.map_err(|error| io_error("write", &error))?;
    temporary
        .persist(folder.join(ENV_FILE))
        .map_err(|error| io_error("write", &error.error))?;
    Ok(())
}

/// Writes the token to `<folder>/.env`.
///
/// # Errors
///
/// `InvalidInput` for a token that is not made of the allowed characters, `Files` for a `.env`
/// that is a link or a folder, or that cannot be read or written. The error never has the token.
pub fn set_token(folder: &Path, token: &Token) -> Result<(), RunError> {
    let value = token.check()?;
    let lines = read_lines(folder)?;
    write_lines(folder, &with_key(&lines, TOKEN_KEY, Some(value)))
}

/// Writes the development server id, or removes it for `None`.
///
/// # Errors
///
/// `InvalidInput` for an id that is not 1 to 20 digits, `Files` as for [`set_token`].
pub fn set_dev_guild(folder: &Path, guild: Option<&str>) -> Result<(), RunError> {
    if let Some(id) = guild
        && !is_id(id)
    {
        return Err(RunError::InvalidInput(format!(
            "the server id must have 1 to {MAX_ID_DIGITS} digits"
        )));
    }
    let lines = read_lines(folder)?;
    write_lines(folder, &with_key(&lines, DEV_GUILD_KEY, guild))
}

/// Whether a token is set, and the development server.
///
/// # Errors
///
/// `Files` for a `.env` that is a link or a folder or cannot be read.
pub fn settings(folder: &Path) -> Result<RunSettings, RunError> {
    let mut token_set = false;
    let mut dev_guild = None;
    for line in read_lines(folder)? {
        match split(&line) {
            Some((TOKEN_KEY, value)) => token_set = !unquoted(value).is_empty(),
            Some((DEV_GUILD_KEY, value)) => {
                let id = unquoted(value);
                dev_guild = is_id(id).then(|| id.to_owned());
            }
            _ => {}
        }
    }
    Ok(RunSettings {
        token_set,
        dev_guild,
    })
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use proptest::prelude::*;

    use super::*;

    const MARKER: &str = "MARKER-token.AbC_123-xyz";

    fn read(dir: &Path) -> String {
        fs::read_to_string(dir.join(ENV_FILE)).expect("the file exists")
    }

    fn mode(dir: &Path) -> u32 {
        fs::metadata(dir.join(ENV_FILE))
            .expect("the file exists")
            .permissions()
            .mode()
            & 0o777
    }

    #[test]
    fn a_new_env_has_mode_0600_and_one_line() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        set_token(dir.path(), &Token::new(MARKER)).expect("it writes");
        assert_eq!(read(dir.path()), format!("DISCORD_TOKEN={MARKER}\n"));
        assert_eq!(mode(dir.path()), 0o600);
    }

    #[test]
    fn an_old_file_is_rewritten_with_mode_0600_and_keeps_the_other_lines() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let path = dir.path().join(ENV_FILE);
        fs::write(
            &path,
            "# mine\nDISCORD_TOKEN=old\nOTHER=1\nDISCORD_DEV_GUILD_ID=42\nexport DISCORD_TOKEN=\n",
        )
        .expect("a file");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("a mode");

        set_token(dir.path(), &Token::new(MARKER)).expect("it writes");

        assert_eq!(
            read(dir.path()),
            format!(
                "# mine\nDISCORD_TOKEN={MARKER}\nOTHER=1\nDISCORD_DEV_GUILD_ID=42\nexport DISCORD_TOKEN=\n"
            )
        );
        assert_eq!(mode(dir.path()), 0o600);
        // No temporary file is left behind.
        assert_eq!(fs::read_dir(dir.path()).expect("it lists").count(), 1);
    }

    #[test]
    fn a_repeated_key_leaves_one_line() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        fs::write(
            dir.path().join(ENV_FILE),
            "DISCORD_TOKEN=a\nX=1\nDISCORD_TOKEN = b\n",
        )
        .expect("a file");
        set_token(dir.path(), &Token::new(MARKER)).expect("it writes");
        assert_eq!(read(dir.path()), format!("DISCORD_TOKEN={MARKER}\nX=1\n"));
    }

    #[test]
    fn a_token_that_could_change_another_line_is_refused() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let long = "a".repeat(MAX_TOKEN_CHARS + 1);
        for bad in [
            "",
            " ",
            "a b",
            "a=b",
            "a\nB=1",
            "a\rb",
            "a#b",
            "\"a\"",
            "a'b",
            "ñ",
            "a\0b",
            long.as_str(),
        ] {
            let error = set_token(dir.path(), &Token::new(bad)).expect_err("it is refused");
            assert!(matches!(error, RunError::InvalidInput(_)), "{bad:?}");
        }
        assert!(!dir.path().join(ENV_FILE).exists());
        set_token(dir.path(), &Token::new("a".repeat(MAX_TOKEN_CHARS))).expect("the longest");
    }

    #[test]
    fn a_link_a_folder_or_a_huge_file_at_env_is_refused() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let target = dir.path().join("target");
        fs::write(&target, "KEEP=1\n").expect("a file");
        let linked = dir.path().join("linked");
        fs::create_dir(&linked).expect("a folder");
        symlink(&target, linked.join(ENV_FILE)).expect("a link");
        let folder = dir.path().join("folder");
        fs::create_dir_all(folder.join(ENV_FILE)).expect("a folder");
        let huge = dir.path().join("huge");
        fs::create_dir(&huge).expect("a folder");
        fs::write(huge.join(ENV_FILE), "a".repeat(70_000)).expect("a file");

        for case in [&linked, &folder, &huge] {
            assert!(matches!(
                set_token(case, &Token::new(MARKER)),
                Err(RunError::Files(_))
            ));
            assert!(matches!(settings(case), Err(RunError::Files(_))));
        }
        assert_eq!(
            fs::read_to_string(&target).expect("it reads"),
            "KEEP=1\n",
            "the link is not followed"
        );
    }

    #[test]
    fn the_status_says_only_whether_a_token_is_set() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        assert_eq!(
            settings(dir.path()).expect("no file"),
            RunSettings {
                token_set: false,
                dev_guild: None
            }
        );
        for (text, set) in [
            ("DISCORD_TOKEN=\n", false),
            ("DISCORD_TOKEN=\"\"\n", false),
            ("# DISCORD_TOKEN=abc\n", false),
            ("DISCORD_TOKEN=abc\n", true),
            ("DISCORD_TOKEN='abc'\n", true),
        ] {
            fs::write(dir.path().join(ENV_FILE), text).expect("a file");
            assert_eq!(settings(dir.path()).expect("it reads").token_set, set);
        }
        let shown = format!("{:?}", settings(dir.path()).expect("it reads"));
        assert!(!shown.contains("abc"));
    }

    #[test]
    fn the_dev_server_is_set_read_and_removed() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        set_token(dir.path(), &Token::new(MARKER)).expect("it writes");
        set_dev_guild(dir.path(), Some("123456789012345678")).expect("it writes");
        let read_back = settings(dir.path()).expect("it reads");
        assert!(read_back.token_set);
        assert_eq!(read_back.dev_guild.as_deref(), Some("123456789012345678"));
        assert_eq!(mode(dir.path()), 0o600);

        set_dev_guild(dir.path(), None).expect("it removes");
        assert_eq!(read(dir.path()), format!("DISCORD_TOKEN={MARKER}\n"));
        assert_eq!(settings(dir.path()).expect("it reads").dev_guild, None);
    }

    #[test]
    fn a_bad_server_id_is_refused() {
        let dir = tempfile::tempdir().expect("a temporary folder");
        let long = "1".repeat(MAX_ID_DIGITS + 1);
        for bad in ["", "abc", "12 3", "1\nTOKEN=x", "-1", "１２", long.as_str()] {
            assert!(
                matches!(
                    set_dev_guild(dir.path(), Some(bad)),
                    Err(RunError::InvalidInput(_))
                ),
                "{bad:?}"
            );
        }
        assert!(!dir.path().join(ENV_FILE).exists());
        set_dev_guild(dir.path(), Some(&"1".repeat(MAX_ID_DIGITS))).expect("the longest");
    }

    #[test]
    fn nothing_shows_the_token() {
        let token = Token::new(MARKER);
        assert!(!format!("{token:?}").contains(MARKER));
        let dir = tempfile::tempdir().expect("a temporary folder");
        fs::create_dir(dir.path().join(ENV_FILE)).expect("a folder");
        let error = set_token(dir.path(), &token).expect_err("a folder at .env");
        assert!(!format!("{error} {error:?}").contains(MARKER));
        let json = serde_json::to_string(&error).expect("it serializes");
        assert!(!json.contains(MARKER));
    }

    proptest! {
        /// Whatever the text, the call does not panic and a written file differs from the old
        /// one in the token line only.
        #[test]
        fn arbitrary_tokens_change_at_most_the_token_line(
            token in "\\PC{0,40}",
            old in "[A-Za-z_=# \n]{0,60}",
        ) {
            let dir = tempfile::tempdir().expect("a temporary folder");
            fs::write(dir.path().join(ENV_FILE), &old).expect("a file");
            if set_token(dir.path(), &Token::new(token.clone())).is_ok() {
                let new = read(dir.path());
                let kept: Vec<_> = old
                    .lines()
                    .filter(|line| split(line).is_none_or(|(k, _)| k != TOKEN_KEY))
                    .collect();
                let now: Vec<_> = new
                    .lines()
                    .filter(|line| split(line).is_none_or(|(k, _)| k != TOKEN_KEY))
                    .collect();
                prop_assert_eq!(kept, now);
                prop_assert_eq!(
                    new.lines().filter(|l| split(l).is_some_and(|(k, _)| k == TOKEN_KEY)).count(),
                    1
                );
            } else {
                prop_assert_eq!(read(dir.path()), old);
            }
        }
    }
}
