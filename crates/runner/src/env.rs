//! Where the runner finds its files, and the `.env` file (`docs/ARCHITECTURE.md` §9.1).

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::failure::Failure;

pub const PAYLOAD_VAR: &str = "BOT_INVENTOR_PAYLOAD";
pub const ENV_FILE_VAR: &str = "BOT_INVENTOR_ENV_FILE";
pub const ASSETS_DIR_VAR: &str = "BOT_INVENTOR_ASSETS_DIR";
pub const DATA_DIR_VAR: &str = "BOT_INVENTOR_DATA_DIR";
/// A `host:port` that stands in for Discord's HTTP API, over plain HTTP. It is for tests; it is
/// read from the environment of the process and never from `.env`, so a project cannot set it.
pub const PROXY_VAR: &str = "BOT_INVENTOR_DISCORD_PROXY";

pub const TOKEN_KEY: &str = "DISCORD_TOKEN";
pub const DEV_GUILD_KEY: &str = "DISCORD_DEV_GUILD_ID";

/// More than this in a `.env` is not a `.env`.
const MAX_ENV_BYTES: u64 = 64 * 1024;

/// The files and folders of one run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// The payload file, when the environment names one.
    pub payload: Option<PathBuf>,
    pub env_file: PathBuf,
    pub assets_dir: PathBuf,
    pub data_dir: PathBuf,
    pub proxy: Option<String>,
}

impl Settings {
    /// Reads the variables with `get`; what they leave out is looked for next to the executable
    /// (`dir`), not in the working directory.
    #[must_use]
    pub fn resolve(dir: &Path, get: impl Fn(&str) -> Option<OsString>) -> Self {
        let path = |name: &str, default: &str| {
            get(name)
                .filter(|value| !value.is_empty())
                .map_or_else(|| dir.join(default), PathBuf::from)
        };
        Self {
            payload: get(PAYLOAD_VAR)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
            env_file: path(ENV_FILE_VAR, ".env"),
            assets_dir: path(ASSETS_DIR_VAR, "assets"),
            data_dir: path(DATA_DIR_VAR, "data"),
            proxy: get(PROXY_VAR)
                .and_then(|value| value.into_string().ok())
                .filter(|value| !value.is_empty()),
        }
    }

    /// The settings of this process: its environment, and the folder of the executable.
    #[must_use]
    pub fn from_process() -> Self {
        let dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
            .unwrap_or_default();
        Self::resolve(&dir, |name| std::env::var_os(name))
    }
}

/// The `KEY=VALUE` lines of a `.env`.
#[derive(Debug, Default)]
pub struct EnvFile {
    values: HashMap<String, String>,
}

impl EnvFile {
    /// Reads `KEY=VALUE` lines. Blank lines and lines that start with `#` are skipped, a value
    /// may be wrapped in one pair of quotes, and a line that is not a `KEY=VALUE` is ignored
    /// (it is not repeated anywhere, because it may be a token).
    #[must_use]
    pub fn parse(text: &str) -> Self {
        let mut values = HashMap::new();
        for line in text.trim_start_matches('\u{feff}').lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            if key.is_empty() {
                continue;
            }
            values.insert(key.to_owned(), unquote(value.trim()).to_owned());
        }
        Self { values }
    }

    /// The value of `key`, if there is a non-empty one.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&str> {
        self.values
            .get(key)
            .map(String::as_str)
            .filter(|value| !value.is_empty())
    }
}

fn unquote(value: &str) -> &str {
    for quote in ['"', '\''] {
        if let Some(inner) = value
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
        {
            return inner;
        }
    }
    value
}

/// What reading a `.env` found.
#[derive(Debug)]
pub struct LoadedEnv {
    pub file: EnvFile,
    /// The file can be read by other users.
    pub shared: bool,
}

/// Reads the `.env` at `path`.
///
/// # Errors
///
/// A configuration [`Failure`] when the file is missing, is not a file, is too large or is not
/// text.
pub fn load(path: &Path) -> Result<LoadedEnv, Failure> {
    let missing = || {
        Failure::config(format!(
            "cannot read the env file `{}`: create it with a line `{TOKEN_KEY}=<the bot token>` \
             (mode 600)",
            path.display()
        ))
    };
    let file = fs::File::open(path).map_err(|_| missing())?;
    let metadata = file.metadata().map_err(|_| missing())?;
    if !metadata.is_file() {
        return Err(missing());
    }
    let mut text = String::new();
    file.take(MAX_ENV_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| {
            Failure::config(format!(
                "the env file `{}` is not valid text",
                path.display()
            ))
        })?;
    if text.len() as u64 > MAX_ENV_BYTES {
        return Err(Failure::config(format!(
            "the env file `{}` is larger than {MAX_ENV_BYTES} bytes",
            path.display()
        )));
    }
    #[cfg(unix)]
    let shared = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o077 != 0
    };
    #[cfg(not(unix))]
    let shared = false;
    Ok(LoadedEnv {
        file: EnvFile::parse(&text),
        shared,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_comments_and_quotes() {
        let env = EnvFile::parse(
            "\u{feff}# a comment\n\nDISCORD_TOKEN = \"abc.def\"\r\nOTHER='x y'\nno equals here\n=novalue\nEMPTY=\nMIXED=\"a'\n",
        );
        assert_eq!(env.get("DISCORD_TOKEN"), Some("abc.def"));
        assert_eq!(env.get("OTHER"), Some("x y"));
        assert_eq!(env.get("EMPTY"), None);
        assert_eq!(env.get("MISSING"), None);
        assert_eq!(env.get("MIXED"), Some("\"a'"));
        assert_eq!(env.get("no equals here"), None);
    }

    #[test]
    fn the_last_line_of_a_key_wins() {
        let env = EnvFile::parse("A=1\nA=2\n");
        assert_eq!(env.get("A"), Some("2"));
    }

    #[test]
    fn paths_come_from_the_environment_or_from_next_to_the_executable() {
        let none = Settings::resolve(Path::new("/bot"), |_| None);
        assert_eq!(none.payload, None);
        assert_eq!(none.env_file, Path::new("/bot/.env"));
        assert_eq!(none.assets_dir, Path::new("/bot/assets"));
        assert_eq!(none.data_dir, Path::new("/bot/data"));
        assert_eq!(none.proxy, None);

        let get = |name: &str| {
            Some(OsString::from(match name {
                PAYLOAD_VAR => "/p/payload.bin",
                ENV_FILE_VAR => "/p/.env",
                ASSETS_DIR_VAR => "/p/assets",
                DATA_DIR_VAR => "/p/data",
                PROXY_VAR => "127.0.0.1:9",
                _ => return None,
            }))
        };
        let all = Settings::resolve(Path::new("/bot"), get);
        assert_eq!(all.payload, Some(PathBuf::from("/p/payload.bin")));
        assert_eq!(all.env_file, Path::new("/p/.env"));
        assert_eq!(all.assets_dir, Path::new("/p/assets"));
        assert_eq!(all.data_dir, Path::new("/p/data"));
        assert_eq!(all.proxy.as_deref(), Some("127.0.0.1:9"));

        let empty = Settings::resolve(Path::new("/bot"), |_| Some(OsString::new()));
        assert_eq!(empty.env_file, Path::new("/bot/.env"));
        assert_eq!(empty.payload, None);
    }

    #[test]
    fn a_missing_env_file_says_what_to_create() {
        let dir = tempfile::tempdir().unwrap();
        let failure = load(&dir.path().join(".env")).unwrap_err();
        assert_eq!(failure.code(), 2);
        assert!(failure.message().contains("DISCORD_TOKEN"));
        let failure = load(dir.path()).unwrap_err();
        assert_eq!(failure.code(), 2);
    }

    #[test]
    fn a_huge_or_binary_env_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("big");
        fs::write(&big, "A=1\n".repeat(30_000)).unwrap();
        assert_eq!(load(&big).unwrap_err().code(), 2);
        let binary = dir.path().join("binary");
        fs::write(&binary, [0xff, 0xfe, 0x00, 0x80]).unwrap();
        assert_eq!(load(&binary).unwrap_err().code(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_other_users_can_read_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "DISCORD_TOKEN=x\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load(&path).unwrap().shared);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!load(&path).unwrap().shared);
    }
}
