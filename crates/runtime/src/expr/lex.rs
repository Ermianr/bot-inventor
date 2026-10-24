//! The little of CEL's lexical rules that the template splitter and the bracket check share.

/// Whether the quote at `start` follows a prefix with `r` in it (`r'…'`, `br'…'`, `rb'…'`).
fn has_raw_prefix(bytes: &[u8], start: usize) -> bool {
    let is_prefix = |byte: u8| matches!(byte, b'r' | b'R' | b'b' | b'B');
    let is_word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    let mut from = start;
    while from > 0 && start - from < 2 && is_prefix(bytes[from - 1]) {
        from -= 1;
    }
    if from > 0 && is_word(bytes[from - 1]) {
        return false;
    }
    bytes[from..start]
        .iter()
        .any(|byte| matches!(byte, b'r' | b'R'))
}

/// The index just after the string literal that opens at `start`, or `None` if it is never closed.
///
/// Handles `'…'`, `"…"`, the triple-quoted forms and raw strings (`r'…'`), where a backslash is
/// not an escape.
pub(super) fn skip_string(bytes: &[u8], start: usize) -> Option<usize> {
    let quote = *bytes.get(start)?;
    let raw = has_raw_prefix(bytes, start);
    let triple = bytes.get(start + 1) == Some(&quote) && bytes.get(start + 2) == Some(&quote);
    let mut i = start + if triple { 3 } else { 1 };
    while i < bytes.len() {
        match bytes[i] {
            b'\\' if !raw => i += 2,
            byte if byte == quote => {
                if !triple {
                    return Some(i + 1);
                }
                if bytes.get(i + 1) == Some(&quote) && bytes.get(i + 2) == Some(&quote) {
                    return Some(i + 3);
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

/// The deepest nesting of `(`, `[` and `{` outside string literals. Counting stops at a string
/// that is never closed; the parser reports that one.
pub(super) fn bracket_depth(source: &str) -> usize {
    let bytes = source.as_bytes();
    let (mut depth, mut deepest, mut i) = (0usize, 0usize, 0);
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' => match skip_string(bytes, i) {
                Some(next) => {
                    i = next;
                    continue;
                }
                None => break,
            },
            b'(' | b'[' | b'{' => {
                depth += 1;
                deepest = deepest.max(depth);
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    deepest
}

/// How many characters that chain a parse deeper (`+ - * / % < > = ! & | ? . ( [`) appear outside
/// string literals. Left-associative operators and `.field` chains make the syntax tree one level
/// deeper each, and the parser and the tree's destructor recurse on it, so this is bounded
/// before the parser sees the source.
pub(super) fn chaining_characters(source: &str) -> usize {
    let bytes = source.as_bytes();
    let (mut count, mut i) = (0usize, 0);
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' => match skip_string(bytes, i) {
                Some(next) => {
                    i = next;
                    continue;
                }
                None => break,
            },
            b'+' | b'-' | b'*' | b'/' | b'%' | b'<' | b'>' | b'=' | b'!' | b'&' | b'|' | b'?'
            | b'.' | b'(' | b'[' => count += 1,
            _ => {}
        }
        i += 1;
    }
    count
}

/// A piece of source text, as byte offsets into it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Token {
    pub kind: TokenKind,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TokenKind {
    Identifier,
    /// A string literal with its quotes and prefix.
    Text,
    Number,
    /// Any other single byte, such as `.`, `[` or `&`.
    Punctuation(u8),
}

/// Splits `source` into tokens, leaving out spaces and `//` comments. A string that is never
/// closed ends the list: the parser reports it, and nothing after it is a token.
pub(super) fn tokens(source: &str) -> Vec<Token> {
    let bytes = source.as_bytes();
    let is_word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte.is_ascii_whitespace() {
            i += 1;
        } else if byte == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if byte.is_ascii_alphabetic() || byte == b'_' {
            let start = i;
            while i < bytes.len() && is_word(bytes[i]) {
                i += 1;
            }
            let word = &bytes[start..i];
            let prefix =
                word.len() <= 2 && word.iter().all(|b| matches!(b, b'r' | b'R' | b'b' | b'B'));
            if prefix && matches!(bytes.get(i), Some(b'\'' | b'"')) {
                let Some(end) = skip_string(bytes, i) else {
                    return out;
                };
                out.push(Token {
                    kind: TokenKind::Text,
                    start,
                    end,
                });
                i = end;
            } else {
                out.push(Token {
                    kind: TokenKind::Identifier,
                    start,
                    end: i,
                });
            }
        } else if byte == b'\'' || byte == b'"' {
            let Some(end) = skip_string(bytes, i) else {
                return out;
            };
            out.push(Token {
                kind: TokenKind::Text,
                start: i,
                end,
            });
            i = end;
        } else if byte.is_ascii_digit() {
            let start = i;
            while i < bytes.len()
                && (is_word(bytes[i])
                    || (bytes[i] == b'.' && bytes.get(i + 1).is_some_and(u8::is_ascii_digit)))
            {
                i += 1;
            }
            out.push(Token {
                kind: TokenKind::Number,
                start,
                end: i,
            });
        } else {
            out.push(Token {
                kind: TokenKind::Punctuation(byte),
                start: i,
                end: i + 1,
            });
            i += 1;
        }
    }
    out
}
