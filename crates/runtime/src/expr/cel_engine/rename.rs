//! Rewrites `steps.<alias>` when a node is renamed.
//!
//! The places to rewrite are found in the token stream, because the positions the parser keeps
//! are not reliable inside a macro. The syntax tree is what decides whether they are right:
//! the rewritten source must parse to the original tree with exactly the reads of the old alias
//! renamed, and anything else is refused. So a read is never missed or invented, whatever the
//! source looks like.

use std::fmt::Write as _;

use cel::common::ast::{EntryExpr, Expr, IdedExpr, LiteralValue};

use super::{CelEngine, is_string_index, literal};
use crate::expr::ExprError;
use crate::expr::lex::{Token, TokenKind, tokens};

const REFUSED: ExprError =
    ExprError::Unsupported("a read of a step that cannot be rewritten with certainty");

/// The longest alias, as in `graph::Alias`.
const MAX_ALIAS_BYTES: usize = 64;

pub(super) fn rename_step(
    engine: &CelEngine,
    source: &str,
    from: &str,
    to: &str,
) -> Result<Option<String>, ExprError> {
    if to.is_empty()
        || to.len() > MAX_ALIAS_BYTES
        || !to
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        || to.as_bytes()[0].is_ascii_digit()
    {
        return Err(ExprError::Unsupported("an alias that is not valid"));
    }
    let program = engine.parse(source)?;
    if from == to {
        return Ok(None);
    }
    let renamed_expected = shape(program.expression(), Some((from, to)));
    let unchanged = shape(program.expression(), None);

    let edits = candidates(source, from);
    if edits.is_empty() {
        return if renamed_expected == unchanged {
            Ok(None)
        } else {
            Err(REFUSED)
        };
    }
    let mut out = String::with_capacity(source.len() + edits.len() * to.len());
    let mut at = 0;
    for (start, end) in edits {
        out.push_str(&source[at..start]);
        out.push_str(to);
        at = end;
    }
    out.push_str(&source[at..]);

    let rewritten = engine.parse(&out)?;
    if shape(rewritten.expression(), None) != renamed_expected {
        return Err(REFUSED);
    }
    if renamed_expected == unchanged {
        // The alias was not read as a step (a macro variable called `steps`, say).
        return Err(REFUSED);
    }
    Ok(Some(out))
}

/// The byte ranges that spell `from` right after a `steps` that is not a field of something.
fn candidates(source: &str, from: &str) -> Vec<(usize, usize)> {
    let found = tokens(source);
    let text = |token: &Token| &source[token.start..token.end];
    let mut edits = Vec::new();
    for (i, token) in found.iter().enumerate() {
        if token.kind != TokenKind::Identifier || text(token) != "steps" {
            continue;
        }
        if i > 0 && found[i - 1].kind == TokenKind::Punctuation(b'.') {
            continue;
        }
        if let Some([dot, name]) = found.get(i + 1..i + 3)
            && dot.kind == TokenKind::Punctuation(b'.')
            && name.kind == TokenKind::Identifier
            && text(name) == from
        {
            edits.push((name.start, name.end));
        }
        if let Some([open, name, close]) = found.get(i + 1..i + 4)
            && open.kind == TokenKind::Punctuation(b'[')
            && name.kind == TokenKind::Text
            && close.kind == TokenKind::Punctuation(b']')
            && let Some((start, end)) = plain_text_inside(source, name)
            && &source[start..end] == from
        {
            edits.push((start, end));
        }
    }
    edits
}

/// The range between the quotes of a string with no prefix and no escape.
fn plain_text_inside(source: &str, token: &Token) -> Option<(usize, usize)> {
    let literal = &source[token.start..token.end];
    let quote = literal.chars().next().filter(|c| matches!(c, '\'' | '"'))?;
    let inner = literal.strip_prefix(quote)?.strip_suffix(quote)?;
    if inner.is_empty() || inner.contains(['\\', '\'', '"', '\n']) {
        return None;
    }
    Some((token.start + 1, token.end - 1))
}

/// The tree as text, ignoring ids and positions. With `rename`, a read of `steps.<from>` is
/// written as a read of `steps.<to>`. Recursive, which is safe because the shape check already
/// limited the depth.
fn shape(root: &IdedExpr, rename: Option<(&str, &str)>) -> String {
    let mut out = String::new();
    write(root, rename, &mut Vec::new(), &mut out);
    out
}

fn is_steps(node: &IdedExpr, bound: &[String]) -> bool {
    matches!(&node.expr, Expr::Ident(name) if name == "steps" && !bound.iter().any(|b| b == name))
}

fn write(node: &IdedExpr, rename: Option<(&str, &str)>, bound: &mut Vec<String>, out: &mut String) {
    let swap = |name: &str| match rename {
        Some((from, to)) if name == from => to.to_owned(),
        _ => name.to_owned(),
    };
    match &node.expr {
        Expr::Ident(name) => {
            let _ = write!(out, "I({name})");
        }
        Expr::Literal(value) => {
            let _ = write!(out, "L({value:?})");
        }
        Expr::Select(select) => {
            let field = if is_steps(&select.operand, bound) {
                swap(&select.field)
            } else {
                select.field.clone()
            };
            let _ = write!(out, "S({field:?},{})(", select.test);
            write(&select.operand, rename, bound, out);
            out.push(')');
        }
        Expr::Call(call) => {
            let _ = write!(out, "C({:?})(", call.func_name);
            if let Some(target) = &call.target {
                out.push('T');
                write(target, rename, bound, out);
            }
            let renamed_index = is_string_index(node)
                && call
                    .args
                    .first()
                    .is_some_and(|operand| is_steps(operand, bound));
            for (position, arg) in call.args.iter().enumerate() {
                out.push(',');
                match literal(arg) {
                    Some(LiteralValue::String(text)) if renamed_index && position == 1 => {
                        let _ = write!(out, "L(String({:?}))", swap(text.inner()));
                    }
                    _ => write(arg, rename, bound, out),
                }
            }
            out.push(')');
        }
        Expr::List(list) => {
            out.push_str("List(");
            for element in &list.elements {
                write(element, rename, bound, out);
                out.push(',');
            }
            out.push(')');
        }
        Expr::Map(map) => {
            out.push_str("Map(");
            for entry in &map.entries {
                match &entry.expr {
                    EntryExpr::MapEntry(pair) => {
                        write(&pair.key, rename, bound, out);
                        out.push(':');
                        write(&pair.value, rename, bound, out);
                    }
                    EntryExpr::StructField(field) => {
                        let _ = write!(out, "{:?}:", field.field);
                        write(&field.value, rename, bound, out);
                    }
                }
                out.push(',');
            }
            out.push(')');
        }
        Expr::Comprehension(comprehension) => {
            let _ = write!(
                out,
                "Comp({:?},{:?},{:?})(",
                comprehension.iter_var, comprehension.iter_var2, comprehension.accu_var
            );
            write(&comprehension.iter_range, rename, bound, out);
            out.push(';');
            write(&comprehension.accu_init, rename, bound, out);
            let added = bound.len();
            bound.push(comprehension.iter_var.clone());
            bound.extend(comprehension.iter_var2.clone());
            bound.push(comprehension.accu_var.clone());
            for part in [
                &comprehension.loop_cond,
                &comprehension.loop_step,
                &comprehension.result,
            ] {
                out.push(';');
                write(part, rename, bound, out);
            }
            bound.truncate(added);
            out.push(')');
        }
        Expr::Struct(_) | Expr::Unspecified => out.push('?'),
    }
}
