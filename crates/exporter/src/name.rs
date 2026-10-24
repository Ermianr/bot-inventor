//! The name of the executable: a plain file name, so that it cannot reach outside the output
//! folder or take the place of a file the exported bot uses.

use crate::error::ExportError;

/// The longest name, in bytes.
pub const MAX_NAME_BYTES: usize = 64;

/// Names a bot may not take: its own folders (`.env` and `.env.example` start with a dot).
const RESERVED: &[&str] = &["assets", "data"];

/// # Errors
///
/// [`ExportError::InvalidName`] with the reason, never the name itself.
pub fn check(name: &str) -> Result<(), ExportError> {
    let invalid = |reason| Err(ExportError::InvalidName { reason });
    if name.is_empty() {
        return invalid("is empty");
    }
    if name.len() > MAX_NAME_BYTES {
        return invalid("is longer than 64 bytes");
    }
    if name.starts_with('.') {
        return invalid("starts with a dot");
    }
    if name.starts_with('-') {
        return invalid("starts with a dash");
    }
    if name.contains(['/', '\\']) {
        return invalid("has a path separator");
    }
    if name.chars().any(char::is_control) {
        return invalid("has a control character");
    }
    if RESERVED.iter().any(|r| name.eq_ignore_ascii_case(r)) {
        return invalid("is a name the exported bot uses for its own files");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_names_pass() {
        for name in [
            "bot",
            "my-bot",
            "My Bot 2",
            "bot.v2",
            "ñandú",
            &"a".repeat(64),
        ] {
            assert!(check(name).is_ok(), "{name}");
        }
    }

    #[test]
    fn bad_names_are_refused() {
        let long = "a".repeat(65);
        for name in [
            "",
            ".",
            "..",
            ".env",
            ".env.example",
            ".hidden",
            "-rf",
            "a/b",
            "../x",
            "/abs",
            "a\\b",
            "a\0b",
            "a\nb",
            "assets",
            "DATA",
            &long,
        ] {
            assert!(
                matches!(check(name), Err(ExportError::InvalidName { .. })),
                "{name:?}"
            );
        }
    }

    #[test]
    fn the_message_does_not_repeat_the_name() {
        let message = check("a/secret-looking").unwrap_err().to_string();
        assert!(!message.contains("secret"), "{message}");
    }
}
