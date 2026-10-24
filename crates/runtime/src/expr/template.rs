use super::lex::skip_string;
use super::{
    ExprError, Expression, ExpressionEngine, MAX_RESULT_BYTES, MAX_TEMPLATE_BYTES, References,
    Scope, Value,
};

/// Plain text with `{{ expression }}` segments, compiled once.
///
/// The source is written by the bot's author. What the segments produce is inserted as text and
/// is not read again, so a Discord user cannot make it evaluate anything. A literal `{{` is
/// written `{{ '{{' }}`; a `}}` outside a segment is plain text.
pub struct Template {
    parts: Vec<Part>,
    references: References,
}

enum Part {
    Text(String),
    Segment(Box<dyn Expression>),
}

impl Template {
    pub fn compile(engine: &dyn ExpressionEngine, source: &str) -> Result<Self, ExprError> {
        if source.len() > MAX_TEMPLATE_BYTES {
            return Err(ExprError::SourceTooLong {
                len: source.len(),
                max: MAX_TEMPLATE_BYTES,
            });
        }
        let mut parts = Vec::new();
        let mut references = References::default();
        let mut rest = source;
        let mut offset = 0;
        while let Some(start) = rest.find("{{") {
            if start > 0 {
                parts.push(Part::Text(rest[..start].to_owned()));
            }
            let body = &rest[start + 2..];
            let end = segment_end(body).ok_or(ExprError::UnclosedSegment {
                offset: offset + start,
            })?;
            let expression = engine.compile(&body[..end])?;
            references.extend(expression.references());
            parts.push(Part::Segment(expression));
            let consumed = start + 2 + end + 2;
            offset += consumed;
            rest = &rest[consumed..];
        }
        if !rest.is_empty() {
            parts.push(Part::Text(rest.to_owned()));
        }
        Ok(Self { parts, references })
    }

    pub fn references(&self) -> &References {
        &self.references
    }

    /// Whether the template has any `{{ }}` segment. Without one it is plain text.
    pub fn has_segments(&self) -> bool {
        self.parts
            .iter()
            .any(|part| matches!(part, Part::Segment(_)))
    }

    /// Renders the template. Numbers, booleans and text are inserted; null, lists and maps are
    /// an error, because there is no single right text for them.
    pub fn render(&self, scope: &Scope) -> Result<String, ExprError> {
        let mut out = String::new();
        for part in &self.parts {
            match part {
                Part::Text(text) => out.push_str(text),
                Part::Segment(expression) => match expression.evaluate(scope)? {
                    Value::String(text) => out.push_str(&text),
                    Value::Bool(flag) => out.push_str(if flag { "true" } else { "false" }),
                    Value::Number(number) => out.push_str(&number.to_string()),
                    Value::Null => {
                        return Err(ExprError::UnsupportedResult("null cannot be inserted"));
                    }
                    Value::Array(_) | Value::Object(_) => {
                        return Err(ExprError::UnsupportedResult(
                            "a list or a map cannot be inserted",
                        ));
                    }
                },
            }
            if out.len() > MAX_RESULT_BYTES {
                return Err(ExprError::ResultTooLarge);
            }
        }
        Ok(out)
    }
}

/// Where the segment that starts at the beginning of `body` ends: the byte of its closing `}}`.
///
/// Quoted text and nested braces are skipped, so `{{ {'a': {'b': 1}} }}` and `{{ '}}' }}` close
/// where the author meant.
fn segment_end(body: &str) -> Option<usize> {
    let bytes = body.as_bytes();
    let mut depth = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' | b'"' => {
                i = skip_string(bytes, i)?;
                continue;
            }
            b'{' => depth += 1,
            b'}' if depth > 0 => depth -= 1,
            b'}' if bytes.get(i + 1) == Some(&b'}') => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Rewrites the reads of `steps.<from>` in the `{{ }}` segments of a template as
/// [`ExpressionEngine::rename_step`] does, and leaves the plain text alone. `None` when no
/// segment reads it.
///
/// # Errors
///
/// When the template has a segment that is never closed, a segment that cannot be rewritten, or
/// the result is longer than a template may be.
pub fn rename_step_in_template(
    engine: &dyn ExpressionEngine,
    source: &str,
    from: &str,
    to: &str,
) -> Result<Option<String>, ExprError> {
    if source.len() > MAX_TEMPLATE_BYTES {
        return Err(ExprError::SourceTooLong {
            len: source.len(),
            max: MAX_TEMPLATE_BYTES,
        });
    }
    let mut out = String::with_capacity(source.len());
    let mut changed = false;
    let mut rest = source;
    let mut offset = 0;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start + 2]);
        let body = &rest[start + 2..];
        let end = segment_end(body).ok_or(ExprError::UnclosedSegment {
            offset: offset + start,
        })?;
        match engine.rename_step(&body[..end], from, to)? {
            Some(new) => {
                changed = true;
                out.push_str(&new);
            }
            None => out.push_str(&body[..end]),
        }
        out.push_str("}}");
        let consumed = start + 2 + end + 2;
        offset += consumed;
        rest = &rest[consumed..];
    }
    out.push_str(rest);
    if out.len() > MAX_TEMPLATE_BYTES {
        return Err(ExprError::SourceTooLong {
            len: out.len(),
            max: MAX_TEMPLATE_BYTES,
        });
    }
    Ok(changed.then_some(out))
}
