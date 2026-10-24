//! The shape of an expression as the condition builder sees it, and the few lexical rules the
//! builder needs to write one. It carries no `cel` types: [`CelEngine`](super::CelEngine) fills it.

/// The part of CEL that the condition builder understands. Anything else is [`Syntax::Other`],
/// which the builder does not touch.
#[derive(Debug, Clone, PartialEq)]
pub enum Syntax {
    /// A name read from one of the four namespaces: `event.user.id` is `["event", "user", "id"]`.
    Name(Vec<String>),
    /// `has(name)`: whether the field exists.
    Presence(Vec<String>),
    Text(String),
    Integer(i64),
    Decimal(f64),
    Boolean(bool),
    Not(Box<Syntax>),
    Binary(Binary, Box<Syntax>, Box<Syntax>),
    /// `target.method(argument)`.
    Method(Method, Box<Syntax>, Box<Syntax>),
    Other,
}

/// The binary operators; `In` is `left in right`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Binary {
    And,
    Or,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    In,
}

/// The text methods the builder offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Contains,
    StartsWith,
    EndsWith,
}

/// Words CEL reserves: they cannot follow a `.`.
const RESERVED: &[&str] = &[
    "as",
    "break",
    "const",
    "continue",
    "else",
    "false",
    "for",
    "function",
    "if",
    "import",
    "in",
    "let",
    "loop",
    "package",
    "namespace",
    "null",
    "return",
    "true",
    "var",
    "void",
    "while",
];

/// Whether `segment` can be written after a `.`.
#[must_use]
pub fn is_identifier(segment: &str) -> bool {
    let mut chars = segment.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !RESERVED.contains(&segment)
}

/// `text` as a CEL string literal in double quotes. Quotes, backslashes and control characters
/// are escaped, so no text can end the literal early.
#[must_use]
pub fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => {
                // `char::is_control` is the Cc category, all of which fit in four digits.
                out.push_str(&format!("\\u{:04x}", u32::from(c)));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A name as source: `event.user.id`, with `['text']` for a segment that is not an identifier.
#[must_use]
pub fn name_source(segments: &[String]) -> String {
    let mut out = String::new();
    for (position, segment) in segments.iter().enumerate() {
        if position == 0 {
            out.push_str(segment);
        } else if is_identifier(segment) {
            out.push('.');
            out.push_str(segment);
        } else {
            out.push('[');
            out.push_str(&quote(segment));
            out.push(']');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_and_reserved_words() {
        for ok in ["a", "_a", "a1", "reason", "A_b"] {
            assert!(is_identifier(ok), "{ok}");
        }
        for bad in ["", "1a", "a-b", "a b", "in", "true", "é", "a.b"] {
            assert!(!is_identifier(bad), "{bad}");
        }
    }

    #[test]
    fn a_name_uses_brackets_where_a_dot_would_not_do() {
        let name = |parts: &[&str]| {
            name_source(&parts.iter().map(|p| (*p).to_owned()).collect::<Vec<_>>())
        };
        assert_eq!(name(&["event", "user", "id"]), "event.user.id");
        assert_eq!(
            name(&["event", "options", "mi-opción"]),
            r#"event.options["mi-opción"]"#
        );
        assert_eq!(name(&["event", "options", "in"]), r#"event.options["in"]"#);
    }

    #[test]
    fn quoting_escapes_what_could_end_or_change_a_literal() {
        assert_eq!(quote("plain"), "\"plain\"");
        assert_eq!(quote("a\"b\\c"), r#""a\"b\\c""#);
        assert_eq!(quote("x\ny\u{0}"), "\"x\\ny\\u0000\"");
    }
}
