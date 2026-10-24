//! The model of the condition builder (`docs/ARCHITECTURE.md` §4.2).
//!
//! A project stores a condition as the text of a CEL expression and nothing else. A
//! [`Condition`] is a view of that text: rows joined by *all* or *any*, each row a comparison, a
//! test on text, a membership or a presence test, chosen from lists. [`Condition::to_source`]
//! writes the expression and [`Condition::from_source`] reads one back, and only an expression
//! of exactly this shape is read: anything else stays as text in the advanced mode, untouched.
//!
//! Text typed into a row is always written as a quoted literal with its quotes, backslashes and
//! control characters escaped, so it is data in the expression and never code.

use crate::expr::{
    Binary, ExprError, ExpressionEngine, MAX_SOURCE_BYTES, Method, ROOTS, Syntax, is_identifier,
    name_source, quote,
};

/// The most rows in one condition.
pub const MAX_ROWS: usize = 8;

/// The largest whole number a row holds: the editor keeps numbers as doubles.
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

/// Rows joined by *all* (`&&`) or *any* (`||`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(
    feature = "specta",
    derive(serde::Serialize, serde::Deserialize, specta::Type)
)]
pub struct Condition {
    pub join: Join,
    pub rows: Vec<Row>,
}

/// How the rows combine. A condition of one row is always `All`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "specta",
    derive(serde::Serialize, serde::Deserialize, specta::Type)
)]
pub enum Join {
    All,
    Any,
}

/// One test.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(
    feature = "specta",
    derive(serde::Serialize, serde::Deserialize, specta::Type)
)]
#[cfg_attr(feature = "specta", serde(tag = "type"))]
pub enum Row {
    /// `left == right`, `left < right`, …
    Compare {
        left: Operand,
        op: Compare,
        right: Operand,
    },
    /// `left.contains(right)`, `left.startsWith(right)`, `left.endsWith(right)`.
    Text {
        negated: bool,
        left: Operand,
        op: TextTest,
        right: Operand,
    },
    /// `item in list`: a role among the roles of the member, for example.
    Member {
        negated: bool,
        item: Operand,
        list: Operand,
    },
    /// `has(name)`: the field exists, as an optional option of a command may not.
    Present { negated: bool, name: Vec<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "specta",
    derive(serde::Serialize, serde::Deserialize, specta::Type)
)]
pub enum Compare {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "specta",
    derive(serde::Serialize, serde::Deserialize, specta::Type)
)]
pub enum TextTest {
    Contains,
    StartsWith,
    EndsWith,
}

/// A side of a test: a name picked from the list, or a value typed in.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(
    feature = "specta",
    derive(serde::Serialize, serde::Deserialize, specta::Type)
)]
#[cfg_attr(feature = "specta", serde(tag = "type", content = "value"))]
pub enum Operand {
    /// A name such as `event.user.id`, as its segments.
    Name(Vec<String>),
    Text(String),
    Integer(#[cfg_attr(feature = "specta", specta(type = i32))] i64),
    Decimal(f64),
    Boolean(bool),
}

/// Why a condition cannot be written as an expression. Messages carry no typed text.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ConditionError {
    #[error("a condition needs at least one row")]
    NoRows,
    #[error("a condition has at most {MAX_ROWS} rows")]
    TooManyRows,
    #[error("a name must start with `event`, `steps`, `vars` or `error` and have a field")]
    BadName,
    #[error("a whole number must be between -2^53 and 2^53, and a decimal must be finite")]
    BadNumber,
    #[error("a test on text needs a name or text on its left")]
    BadReceiver,
    #[error("the field cannot be tested for presence by its name; compare it instead")]
    NotExpressible,
    #[error("the expression would be longer than {MAX_SOURCE_BYTES} bytes")]
    TooLong,
    #[error("the condition does not make a valid expression: {0}")]
    Invalid(#[from] ExprError),
}

impl Condition {
    /// The CEL source of the condition.
    ///
    /// # Errors
    ///
    /// [`ConditionError`] when there are no rows or too many, a name or a number is not valid, or
    /// the result is not an expression the engine accepts. Nothing is written for a bad row.
    pub fn to_source(&self, engine: &dyn ExpressionEngine) -> Result<String, ConditionError> {
        match self.rows.len() {
            0 => return Err(ConditionError::NoRows),
            n if n > MAX_ROWS => return Err(ConditionError::TooManyRows),
            _ => {}
        }
        let joiner = match self.join {
            Join::Any => " || ",
            Join::All => " && ",
        };
        let mut parts = Vec::with_capacity(self.rows.len());
        for row in &self.rows {
            parts.push(row.source()?);
        }
        let source = parts.join(joiner);
        if source.len() > MAX_SOURCE_BYTES {
            return Err(ConditionError::TooLong);
        }
        engine.compile(&source)?;
        Ok(source)
    }

    /// The condition that `source` spells, or `None` when it is an expression of another shape.
    ///
    /// # Errors
    ///
    /// The [`ExprError`] of an expression that does not compile.
    pub fn from_source(
        engine: &dyn ExpressionEngine,
        source: &str,
    ) -> Result<Option<Self>, ExprError> {
        let tree = engine.syntax(source)?;
        let (join, leaves) = match &tree {
            Syntax::Binary(Binary::And, ..) => (Join::All, flatten(&tree, Binary::And)),
            Syntax::Binary(Binary::Or, ..) => (Join::Any, flatten(&tree, Binary::Or)),
            _ => (Join::All, Some(vec![&tree])),
        };
        let Some(leaves) = leaves.filter(|leaves| leaves.len() <= MAX_ROWS) else {
            return Ok(None);
        };
        let rows: Option<Vec<Row>> = leaves.into_iter().map(Row::from_syntax).collect();
        Ok(rows.map(|rows| Self { join, rows }))
    }
}

/// The operands of a chain of one operator, left to right; `None` if the chain holds the other
/// operator, as in `a && (b || c)`.
fn flatten(tree: &Syntax, operator: Binary) -> Option<Vec<&Syntax>> {
    let mut out = Vec::new();
    let mut stack = vec![tree];
    while let Some(node) = stack.pop() {
        match node {
            Syntax::Binary(op, left, right) if *op == operator => {
                stack.push(right);
                stack.push(left);
            }
            Syntax::Binary(Binary::And | Binary::Or, ..) => return None,
            leaf => out.push(leaf),
        }
        if out.len() > MAX_ROWS {
            return None;
        }
    }
    Some(out)
}

impl Row {
    fn from_syntax(tree: &Syntax) -> Option<Self> {
        let (negated, tree) = match tree {
            Syntax::Not(inner) => (true, &**inner),
            other => (false, other),
        };
        match tree {
            Syntax::Binary(op, left, right) => {
                if *op == Binary::In {
                    return Some(Row::Member {
                        negated,
                        item: Operand::from_syntax(left)?,
                        list: Operand::from_syntax(right)?,
                    });
                }
                // `!(a == b)` is not a row: it would be rewritten as `a != b`.
                let op = match op {
                    Binary::Eq => Compare::Eq,
                    Binary::Ne => Compare::Ne,
                    Binary::Lt => Compare::Lt,
                    Binary::Le => Compare::Le,
                    Binary::Gt => Compare::Gt,
                    Binary::Ge => Compare::Ge,
                    Binary::And | Binary::Or | Binary::In => return None,
                };
                if negated {
                    return None;
                }
                Some(Row::Compare {
                    left: Operand::from_syntax(left)?,
                    op,
                    right: Operand::from_syntax(right)?,
                })
            }
            Syntax::Method(method, left, right) => Some(Row::Text {
                negated,
                left: Operand::from_syntax(left)?,
                op: match method {
                    Method::Contains => TextTest::Contains,
                    Method::StartsWith => TextTest::StartsWith,
                    Method::EndsWith => TextTest::EndsWith,
                },
                right: Operand::from_syntax(right)?,
            }),
            Syntax::Presence(name) if is_name(name) => Some(Row::Present {
                negated,
                name: name.clone(),
            }),
            _ => None,
        }
    }

    fn source(&self) -> Result<String, ConditionError> {
        Ok(match self {
            Row::Compare { left, op, right } => {
                let op = match op {
                    Compare::Eq => "==",
                    Compare::Ne => "!=",
                    Compare::Lt => "<",
                    Compare::Le => "<=",
                    Compare::Gt => ">",
                    Compare::Ge => ">=",
                };
                format!("{} {op} {}", left.source()?, right.source()?)
            }
            Row::Text {
                negated,
                left,
                op,
                right,
            } => {
                let method = match op {
                    TextTest::Contains => "contains",
                    TextTest::StartsWith => "startsWith",
                    TextTest::EndsWith => "endsWith",
                };
                let not = if *negated { "!" } else { "" };
                format!("{not}{}.{method}({})", left.receiver()?, right.source()?)
            }
            Row::Member {
                negated,
                item,
                list,
            } => {
                let test = format!("{} in {}", item.source()?, list.source()?);
                if *negated { format!("!({test})") } else { test }
            }
            Row::Present { negated, name } => {
                // `has()` takes a field selection, so the last segment must be one.
                if !is_name(name) || !name.last().is_some_and(|last| is_identifier(last)) {
                    return Err(if is_name(name) {
                        ConditionError::NotExpressible
                    } else {
                        ConditionError::BadName
                    });
                }
                let not = if *negated { "!" } else { "" };
                format!("{not}has({})", name_source(name))
            }
        })
    }
}

fn is_name(segments: &[String]) -> bool {
    segments.len() >= 2
        && ROOTS.contains(&segments[0].as_str())
        && segments.iter().all(|segment| !segment.is_empty())
}

impl Operand {
    fn from_syntax(tree: &Syntax) -> Option<Self> {
        Some(match tree {
            Syntax::Name(segments) if is_name(segments) => Self::Name(segments.clone()),
            Syntax::Text(text) => Self::Text(text.clone()),
            Syntax::Integer(number) => Self::Integer(*number),
            Syntax::Decimal(number) => Self::Decimal(*number),
            Syntax::Boolean(flag) => Self::Boolean(*flag),
            _ => return None,
        })
    }

    fn source(&self) -> Result<String, ConditionError> {
        Ok(match self {
            Self::Name(segments) if is_name(segments) => name_source(segments),
            Self::Name(_) => return Err(ConditionError::BadName),
            Self::Text(text) => quote(text),
            Self::Integer(number) if number.unsigned_abs() <= MAX_SAFE_INTEGER.unsigned_abs() => {
                number.to_string()
            }
            Self::Decimal(number) if number.is_finite() => format!("{number:?}"),
            Self::Integer(_) | Self::Decimal(_) => return Err(ConditionError::BadNumber),
            Self::Boolean(flag) => flag.to_string(),
        })
    }

    /// The operand as the target of a method call: a negative number or an operator in front
    /// would bind the wrong way, so only names and text are allowed.
    fn receiver(&self) -> Result<String, ConditionError> {
        match self {
            Self::Name(_) | Self::Text(_) => self.source(),
            _ => Err(ConditionError::BadReceiver),
        }
    }
}
