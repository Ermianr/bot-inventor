//! Why the runner stops, and the exit code each reason has (`docs/ARCHITECTURE.md` §9.3).

use std::process::ExitCode;

use platform_discord::AdapterError;
use runtime::graph::PayloadError;
use runtime::run::RuntimeError;
use runtime::storage::StorageError;

/// The exit code for a configuration problem: a missing token or asset, a wrong argument.
pub const CONFIG: u8 = 2;
/// The exit code for a payload version this runner does not read.
pub const PAYLOAD_VERSION: u8 = 3;
/// The exit code for any other failure.
pub const OTHER: u8 = 1;

/// A reason to stop. The message is one line that says what to fix; it never holds the token,
/// a stored value or text from Discord.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    code: u8,
    message: String,
}

impl Failure {
    /// A configuration problem (exit code 2).
    #[must_use]
    pub fn config(message: impl Into<String>) -> Self {
        Self {
            code: CONFIG,
            message: message.into(),
        }
    }

    /// A failure that is not the user's configuration (exit code 1).
    #[must_use]
    pub fn other(message: impl Into<String>) -> Self {
        Self {
            code: OTHER,
            message: message.into(),
        }
    }

    #[must_use]
    pub const fn code(&self) -> u8 {
        self.code
    }

    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }

    /// The message with `redact` applied, as the runner prints it.
    #[must_use]
    pub fn with_message(self, redact: impl FnOnce(&str) -> String) -> Self {
        Self {
            message: redact(&self.message),
            ..self
        }
    }

    #[must_use]
    pub fn exit_code(&self) -> ExitCode {
        ExitCode::from(self.code)
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<PayloadError> for Failure {
    fn from(error: PayloadError) -> Self {
        let code = match error {
            PayloadError::NewerVersion { .. } | PayloadError::OlderVersion { .. } => {
                PAYLOAD_VERSION
            }
            _ => OTHER,
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

impl From<AdapterError> for Failure {
    fn from(error: AdapterError) -> Self {
        match error {
            AdapterError::UnknownIntent(_)
            | AdapterError::UnknownCache(_)
            | AdapterError::UnsupportedCommand(_)
            | AdapterError::InvalidToken
            | AdapterError::InvalidGuildId => Self::config(error.to_string()),
            AdapterError::GatewayClosed => Self::other(format!(
                "{error}; check the token and the privileged intents of the application"
            )),
            AdapterError::Api(_) | AdapterError::Network => Self::other(error.to_string()),
        }
    }
}

impl From<StorageError> for Failure {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::TypeMismatch { .. }
            | StorageError::NewerDatabase { .. }
            | StorageError::File(_) => Self::config(error.to_string()),
            _ => Self::other(error.to_string()),
        }
    }
}

impl From<RuntimeError> for Failure {
    fn from(error: RuntimeError) -> Self {
        Self::other(format!("the bot cannot be run: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_reason_has_its_code() {
        assert_eq!(Failure::config("x").code(), 2);
        assert_eq!(Failure::other("x").code(), 1);
        assert_eq!(
            Failure::from(PayloadError::NewerVersion {
                found: 9,
                supported: 1
            })
            .code(),
            3
        );
        assert_eq!(
            Failure::from(PayloadError::OlderVersion {
                found: 1,
                supported: 2
            })
            .code(),
            3
        );
        assert_eq!(Failure::from(PayloadError::Empty).code(), 1);
        assert_eq!(Failure::from(AdapterError::InvalidToken).code(), 2);
        assert_eq!(Failure::from(AdapterError::InvalidGuildId).code(), 2);
        assert_eq!(Failure::from(AdapterError::Network).code(), 1);
        assert_eq!(Failure::from(AdapterError::Api(500)).code(), 1);
        assert_eq!(Failure::from(AdapterError::GatewayClosed).code(), 1);
        let mismatch = StorageError::TypeMismatch {
            variable: "bot.n".to_owned(),
            stored: "text",
            declared: "integer",
        };
        assert_eq!(Failure::from(mismatch).code(), 2);
        assert_eq!(Failure::from(StorageError::Closed).code(), 1);
    }

    #[test]
    fn the_message_can_be_rewritten() {
        let failure = Failure::config("a secret").with_message(|text| text.replace("secret", "x"));
        assert_eq!(failure.message(), "a x");
        assert_eq!(failure.code(), 2);
    }
}
