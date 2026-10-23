//! The bot token, kept out of every output.

use std::fmt;

/// A bot token. It has no `Display`, and its `Debug` shows nothing of it, so it cannot reach a
/// log or an error by accident.
#[derive(Clone)]
pub struct Token(String);

impl Token {
    /// Wraps `token`, with the spaces around it removed. Returns `None` when nothing is left.
    #[must_use]
    pub fn new(token: &str) -> Option<Self> {
        let token = token.trim();
        (!token.is_empty()).then(|| Self(token.to_owned()))
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_shows_nothing_of_the_token() {
        let token = Token::new("  secret-value ").unwrap();
        assert_eq!(token.expose(), "secret-value");
        assert_eq!(format!("{token:?}"), "Token(<redacted>)");
        assert_eq!(format!("{token:#?}"), "Token(<redacted>)");
    }

    #[test]
    fn an_empty_token_is_none() {
        assert!(Token::new("").is_none());
        assert!(Token::new(" \n").is_none());
    }
}
