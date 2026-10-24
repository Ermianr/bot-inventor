//! Validated names: a value of these types has already passed its rules, so an
//! invalid one cannot exist once a project is parsed.

use std::fmt;

use serde::{Deserialize, Serialize};

/// The longest name, in bytes (names are ASCII).
pub const MAX_NAME_LEN: usize = 64;

/// A name that does not follow the rules of its kind.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid {what} `{value}`: {reason}")]
pub struct NameError {
    what: &'static str,
    value: String,
    reason: String,
}

fn check(
    what: &'static str,
    value: &str,
    first: fn(char) -> bool,
    rest: fn(char) -> bool,
    rules: &'static str,
) -> Result<(), NameError> {
    let fail = |reason: String| NameError {
        what,
        // A bad value can be as long as the file allows; the message keeps a short prefix.
        value: value.chars().take(MAX_NAME_LEN).collect(),
        reason,
    };
    if value.is_empty() {
        return Err(fail("it is empty".to_owned()));
    }
    if value.len() > MAX_NAME_LEN {
        return Err(fail(format!("it is longer than {MAX_NAME_LEN} characters")));
    }
    let mut chars = value.chars();
    let starts_well = chars.next().is_some_and(first);
    if !starts_well || !chars.all(rest) {
        return Err(fail(format!("it must be {rules}")));
    }
    Ok(())
}

fn is_lower_or_digit(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit()
}

macro_rules! name_type {
    ($(#[$doc:meta])* $name:ident, $what:literal, $rules:literal, $first:expr, $rest:expr) => {
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        #[cfg_attr(feature = "specta", derive(specta::Type))]
        pub struct $name(String);

        impl $name {
            /// Checks `value` against the rules of this kind of name.
            ///
            /// # Errors
            ///
            /// Returns a [`NameError`] that says which rule failed.
            pub fn parse(value: &str) -> Result<Self, NameError> {
                check($what, value, $first, $rest, $rules)?;
                Ok(Self(value.to_owned()))
            }

            /// The name as text.
            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = NameError;

            fn try_from(value: String) -> Result<Self, NameError> {
                check($what, &value, $first, $rest, $rules)?;
                Ok(Self(value))
            }
        }

        impl From<$name> for String {
            fn from(name: $name) -> String {
                name.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

name_type!(
    /// The opaque, stable id of a node, created by the editor.
    NodeId,
    "node id",
    "1-64 letters, digits, `_` or `-`",
    |c| c.is_ascii_alphanumeric() || c == '_' || c == '-',
    |c| c.is_ascii_alphanumeric() || c == '_' || c == '-'
);

name_type!(
    /// The name of a flow; it is also the stem of its file, `flows/<name>.flow.json`.
    FlowName,
    "flow name",
    "1-64 lowercase letters, digits, `_` or `-`, starting with a letter or a digit",
    is_lower_or_digit,
    |c| is_lower_or_digit(c) || c == '_' || c == '-'
);

name_type!(
    /// The human name of a node, unique inside its flow; expressions read it as
    /// `steps.<alias>`.
    Alias,
    "alias",
    "1-64 lowercase letters, digits or `_`, not starting with a digit",
    |c| c.is_ascii_lowercase() || c == '_',
    |c| is_lower_or_digit(c) || c == '_'
);

name_type!(
    /// The name of an output port of a node, such as `next` or `error`.
    PortName,
    "port name",
    "1-64 lowercase letters, digits or `_`, not starting with a digit",
    |c| c.is_ascii_lowercase() || c == '_',
    |c| is_lower_or_digit(c) || c == '_'
);

name_type!(
    /// The name of a declared variable; expressions read it as `vars.<scope>.<name>`.
    VariableName,
    "variable name",
    "1-64 lowercase letters, digits or `_`, not starting with a digit",
    |c| c.is_ascii_lowercase() || c == '_',
    |c| is_lower_or_digit(c) || c == '_'
);

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_names() {
        assert!(NodeId::parse("n-1_A").is_ok());
        assert!(FlowName::parse("welcome-2").is_ok());
        assert!(Alias::parse("_reply2").is_ok());
        assert!(PortName::parse("next").is_ok());
        assert!(VariableName::parse("warnings").is_ok());
        assert!(NodeId::parse(&"a".repeat(MAX_NAME_LEN)).is_ok());
    }

    #[test]
    fn rejects_invalid_names() {
        let long = "a".repeat(MAX_NAME_LEN + 1);
        for bad in ["", " ", "a b", "a.b", "../x", "a/b", "é", "a\n", &long] {
            assert!(NodeId::parse(bad).is_err(), "node id {bad:?}");
        }
        for bad in ["", "Upper", "-x", "_x", "a.b", "a b", &long] {
            assert!(FlowName::parse(bad).is_err(), "flow name {bad:?}");
        }
        for bad in ["", "1x", "Upper", "a-b", "a.b", "a b", &long] {
            assert!(Alias::parse(bad).is_err(), "alias {bad:?}");
            assert!(PortName::parse(bad).is_err(), "port {bad:?}");
            assert!(VariableName::parse(bad).is_err(), "variable {bad:?}");
        }
    }

    #[test]
    fn the_message_names_the_kind_and_the_rule() {
        let message = Alias::parse("1x").unwrap_err().to_string();
        assert!(message.contains("alias `1x`"), "{message}");
        assert!(message.contains("not starting with a digit"), "{message}");
    }

    #[test]
    fn a_long_bad_value_is_cut_in_the_message() {
        let message = NodeId::parse(&"é".repeat(10_000)).unwrap_err().to_string();
        assert!(message.len() < 500, "{} bytes", message.len());
    }

    #[test]
    fn deserialization_validates() {
        assert!(serde_json::from_str::<Alias>("\"ok\"").is_ok());
        assert!(serde_json::from_str::<Alias>("\"Not ok\"").is_err());
        assert!(serde_json::from_str::<Alias>("5").is_err());
    }
}
