//! The little of CEL's lexical rules that the template splitter and the bracket check share.

/// The index just after the string literal that opens at `start`, or `None` if it is never closed.
///
/// Handles `'…'`, `"…"`, the triple-quoted forms and raw strings (`r'…'`), where a backslash is
/// not an escape.
pub(super) fn skip_string(bytes: &[u8], start: usize) -> Option<usize> {
    let quote = *bytes.get(start)?;
    let raw = start > 0 && matches!(bytes[start - 1], b'r' | b'R');
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
