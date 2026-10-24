//! Describes a parsed expression as a [`Syntax`].

use cel::common::ast::{Expr, IdedExpr, LiteralValue};

use super::{is_string_index, literal};
use crate::expr::{Binary, Method, ROOTS, Syntax};

/// The largest whole number the builder keeps: the editor holds numbers as doubles.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Recursive, which is safe because the shape check already limited the depth.
pub(super) fn syntax(node: &IdedExpr) -> Syntax {
    match &node.expr {
        Expr::Literal(value) => match value {
            LiteralValue::String(text) => Syntax::Text(text.inner().to_owned()),
            LiteralValue::Boolean(flag) => Syntax::Boolean(*flag.inner()),
            LiteralValue::Int(number) if number.inner().unsigned_abs() <= MAX_SAFE_INTEGER => {
                Syntax::Integer(*number.inner())
            }
            LiteralValue::Double(number) if number.inner().is_finite() => {
                Syntax::Decimal(*number.inner())
            }
            _ => Syntax::Other,
        },
        Expr::Ident(_) | Expr::Select(_) => match name(node) {
            Some((segments, false)) => Syntax::Name(segments),
            Some((segments, true)) => Syntax::Presence(segments),
            None => Syntax::Other,
        },
        Expr::Call(call) => {
            if is_string_index(node) {
                return name(node).map_or(Syntax::Other, |(segments, _)| Syntax::Name(segments));
            }
            match (
                call.func_name.as_str(),
                call.target.as_deref(),
                &call.args[..],
            ) {
                ("!_", None, [operand]) => Syntax::Not(Box::new(syntax(operand))),
                (operator, None, [left, right]) => match binary(operator) {
                    // `a in b` is stored as `@in(a, b)`.
                    Some(op) => Syntax::Binary(op, Box::new(syntax(left)), Box::new(syntax(right))),
                    None => Syntax::Other,
                },
                ("contains", Some(target), [argument]) => {
                    method(Method::Contains, target, argument)
                }
                ("startsWith", Some(target), [argument]) => {
                    method(Method::StartsWith, target, argument)
                }
                ("endsWith", Some(target), [argument]) => {
                    method(Method::EndsWith, target, argument)
                }
                _ => Syntax::Other,
            }
        }
        _ => Syntax::Other,
    }
}

fn method(method: Method, target: &IdedExpr, argument: &IdedExpr) -> Syntax {
    Syntax::Method(method, Box::new(syntax(target)), Box::new(syntax(argument)))
}

fn binary(operator: &str) -> Option<Binary> {
    Some(match operator {
        "_&&_" => Binary::And,
        "_||_" => Binary::Or,
        "_==_" => Binary::Eq,
        "_!=_" => Binary::Ne,
        "_<_" => Binary::Lt,
        "_<=_" => Binary::Le,
        "_>_" => Binary::Gt,
        "_>=_" => Binary::Ge,
        "@in" => Binary::In,
        _ => return None,
    })
}

/// The segments of a name rooted in one of the four namespaces, and whether it is a `has()` test.
/// Only the outermost selection may be a test.
fn name(node: &IdedExpr) -> Option<(Vec<String>, bool)> {
    let mut segments = Vec::new();
    let mut current = node;
    let mut test = false;
    let mut first = true;
    loop {
        match &current.expr {
            Expr::Select(select) => {
                if select.test {
                    if !first {
                        return None;
                    }
                    test = true;
                }
                segments.push(select.field.clone());
                current = &select.operand;
            }
            Expr::Call(call) if is_string_index(current) => {
                let LiteralValue::String(text) = call.args.get(1).and_then(literal)? else {
                    return None;
                };
                segments.push(text.inner().to_owned());
                current = call.args.first()?;
            }
            Expr::Ident(root) if ROOTS.contains(&root.as_str()) => {
                segments.push(root.clone());
                segments.reverse();
                return Some((segments, test));
            }
            _ => return None,
        }
        first = false;
    }
}
