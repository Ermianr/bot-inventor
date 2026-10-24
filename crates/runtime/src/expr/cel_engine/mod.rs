//! The only module that uses the `cel` crate (with `convert` and `rename`, which belong to it).

mod convert;
mod rename;

use std::collections::HashMap;
use std::sync::Arc;

use cel::common::ast::{EntryExpr, Expr, IdedExpr, LiteralValue};
use cel::{Context, Env, ExecutionError, Program, Value as CelValue};

use super::lex::{bracket_depth, chaining_characters};
use super::references::{Path, ROOTS, References};
use super::{
    ExprError, Expression, ExpressionEngine, MAX_COMPREHENSION_NESTING, MAX_DEPTH, MAX_NODES,
    MAX_OPERATORS, MAX_RESULT_BYTES, MAX_SOURCE_BYTES, Scope, Syntax, Value,
};

/// Operators and functions an expression may use. All are pure. A name outside this list is
/// refused when the expression is compiled, so adding a function to `cel` or registering one
/// here changes what bots can do only through this list (`allowed_functions_are_a_closed_list`).
const ALLOWED_FUNCTIONS: &[&str] = &[
    // Operators and macros' building blocks.
    "_+_",
    "_-_",
    "_*_",
    "_/_",
    "_%_",
    "-_",
    "!_",
    "_==_",
    "_!=_",
    "_<_",
    "_<=_",
    "_>_",
    "_>=_",
    "_&&_",
    "_||_",
    "_?_:_",
    "_[_]",
    "@in",
    "@not_strictly_false",
    // Named functions and methods.
    "size",
    "contains",
    "startsWith",
    "endsWith",
    "int",
    "uint",
    "double",
    "string",
    "bool",
    "type",
    "dyn",
];

/// Type names that are valid as a bare identifier, as in `type(x) == int`.
const TYPE_NAMES: &[&str] = &[
    "bool",
    "int",
    "uint",
    "double",
    "string",
    "bytes",
    "list",
    "map",
    "null_type",
    "type",
];

/// Compiles CEL with the `cel` crate: the standard library only, with no `regex`, `chrono` or
/// optional values. The base context is built once and shared by every evaluation.
pub struct CelEngine {
    env: Arc<Env>,
    base: Arc<Context<'static, 'static>>,
}

impl CelEngine {
    pub fn new() -> Self {
        let env = Arc::new(Env::stdlib().with_optional_support(false));
        let base = Arc::new(Context::with_env(Arc::clone(&env)));
        Self { env, base }
    }
}

impl Default for CelEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CelEngine {
    /// Parses `source` and checks its length, shape and functions; the names are not looked at.
    fn parse(&self, source: &str) -> Result<Program, ExprError> {
        if source.trim().is_empty() {
            return Err(ExprError::Empty);
        }
        if source.len() > MAX_SOURCE_BYTES {
            return Err(ExprError::SourceTooLong {
                len: source.len(),
                max: MAX_SOURCE_BYTES,
            });
        }
        // Before parsing: deeply nested brackets must not reach the recursive parser.
        if bracket_depth(source) > MAX_DEPTH {
            return Err(ExprError::TooComplex("brackets nested too deeply"));
        }
        if chaining_characters(source) > MAX_OPERATORS {
            return Err(ExprError::TooComplex("too many operators"));
        }
        let program = self
            .env
            .compile(source)
            .map_err(|errors| ExprError::Syntax(short(&errors.to_string())))?;
        check_shape(program.expression())?;
        Ok(program)
    }
}

impl ExpressionEngine for CelEngine {
    fn compile(&self, source: &str) -> Result<Box<dyn Expression>, ExprError> {
        let program = self.parse(source)?;
        let mut references = References::default();
        collect(program.expression(), &mut Vec::new(), &mut references)?;
        Ok(Box::new(CelExpression {
            program,
            references,
            base: Arc::clone(&self.base),
        }))
    }

    fn syntax(&self, source: &str) -> Result<Syntax, ExprError> {
        let program = self.parse(source)?;
        let mut references = References::default();
        collect(program.expression(), &mut Vec::new(), &mut references)?;
        Ok(convert::syntax(program.expression()))
    }

    fn rename_step(&self, source: &str, from: &str, to: &str) -> Result<Option<String>, ExprError> {
        rename::rename_step(self, source, from, to)
    }
}

struct CelExpression {
    program: Program,
    references: References,
    base: Arc<Context<'static, 'static>>,
}

impl Expression for CelExpression {
    fn references(&self) -> &References {
        &self.references
    }

    fn evaluate(&self, scope: &Scope) -> Result<Value, ExprError> {
        let mut context = self.base.new_inner_scope();
        for root in ROOTS {
            if self.references.reads(root)
                && let Some(value) = scope.namespace(root)
            {
                context.add_variable_from_value(root, to_cel(value));
            }
        }
        let result = self.program.execute(&context).map_err(describe)?;
        let mut budget = MAX_RESULT_BYTES;
        to_json(&result, &mut budget)
    }
}

/// Counts nodes, depth and nested macros without recursion, and refuses what the engine does not
/// offer: functions outside the list and struct literals.
fn check_shape(root: &IdedExpr) -> Result<(), ExprError> {
    let mut nodes = 0usize;
    let mut stack = vec![(root, 1usize, 0usize)];
    while let Some((node, depth, nesting)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_NODES {
            return Err(ExprError::TooComplex("too many parts"));
        }
        if depth > MAX_DEPTH {
            return Err(ExprError::TooComplex("nested too deeply"));
        }
        let child = depth + 1;
        match &node.expr {
            Expr::Call(call) => {
                if !ALLOWED_FUNCTIONS.contains(&call.func_name.as_str()) {
                    return Err(ExprError::UnknownFunction(call.func_name.clone()));
                }
                stack.extend(call.target.iter().map(|target| (&**target, child, nesting)));
                stack.extend(call.args.iter().map(|arg| (arg, child, nesting)));
            }
            Expr::Comprehension(comprehension) => {
                if nesting + 1 > MAX_COMPREHENSION_NESTING {
                    return Err(ExprError::TooComplex("macros nested too deeply"));
                }
                stack.push((&comprehension.iter_range, child, nesting));
                for part in [
                    &comprehension.accu_init,
                    &comprehension.loop_cond,
                    &comprehension.loop_step,
                    &comprehension.result,
                ] {
                    stack.push((part, child, nesting + 1));
                }
            }
            Expr::Select(select) => stack.push((&select.operand, child, nesting)),
            Expr::List(list) => stack.extend(list.elements.iter().map(|e| (e, child, nesting))),
            Expr::Map(map) => {
                for entry in &map.entries {
                    match &entry.expr {
                        EntryExpr::MapEntry(pair) => {
                            stack.push((&pair.key, child, nesting));
                            stack.push((&pair.value, child, nesting));
                        }
                        EntryExpr::StructField(field) => {
                            stack.push((&field.value, child, nesting));
                        }
                    }
                }
            }
            Expr::Struct(_) => return Err(ExprError::Unsupported("struct literals")),
            Expr::Unspecified => return Err(ExprError::Unsupported("an empty part")),
            Expr::Ident(_) | Expr::Literal(_) => {}
        }
    }
    Ok(())
}

/// Lists the paths and the named functions of an expression and refuses an unknown name.
///
/// Recursive, which is safe because `check_shape` already limited the depth.
fn collect(
    node: &IdedExpr,
    bound: &mut Vec<String>,
    references: &mut References,
) -> Result<(), ExprError> {
    match &node.expr {
        Expr::Ident(_) | Expr::Select(_) => chain(node, bound, references),
        Expr::Call(call) => {
            if is_string_index(node) {
                return chain(node, bound, references);
            }
            if call
                .func_name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic())
            {
                references.insert_function(call.func_name.clone());
            }
            for part in call.target.iter().map(|t| &**t).chain(&call.args) {
                collect(part, bound, references)?;
            }
            Ok(())
        }
        Expr::Comprehension(comprehension) => {
            collect(&comprehension.iter_range, bound, references)?;
            collect(&comprehension.accu_init, bound, references)?;
            let added = bound.len();
            bound.push(comprehension.iter_var.clone());
            bound.extend(comprehension.iter_var2.clone());
            bound.push(comprehension.accu_var.clone());
            for part in [
                &comprehension.loop_cond,
                &comprehension.loop_step,
                &comprehension.result,
            ] {
                collect(part, bound, references)?;
            }
            bound.truncate(added);
            Ok(())
        }
        Expr::List(list) => list
            .elements
            .iter()
            .try_for_each(|element| collect(element, bound, references)),
        Expr::Map(map) => {
            for entry in &map.entries {
                match &entry.expr {
                    EntryExpr::MapEntry(pair) => {
                        collect(&pair.key, bound, references)?;
                        collect(&pair.value, bound, references)?;
                    }
                    EntryExpr::StructField(field) => collect(&field.value, bound, references)?,
                }
            }
            Ok(())
        }
        Expr::Literal(_) | Expr::Struct(_) | Expr::Unspecified => Ok(()),
    }
}

/// Handles a chain of `.field` and `['literal']` over some base, recording the fixed path.
fn chain(
    node: &IdedExpr,
    bound: &mut Vec<String>,
    references: &mut References,
) -> Result<(), ExprError> {
    let mut segments = Vec::new();
    let mut current = node;
    loop {
        match &current.expr {
            Expr::Select(select) => {
                segments.push(select.field.clone());
                current = &select.operand;
            }
            Expr::Call(call) if is_string_index(current) => {
                if let Some(LiteralValue::String(text)) = call.args.get(1).and_then(literal) {
                    segments.push(text.inner().to_owned());
                }
                match call.args.first() {
                    Some(operand) => current = operand,
                    None => return Ok(()),
                }
            }
            Expr::Ident(name) => {
                if bound.iter().any(|b| b == name) || name.starts_with('@') {
                    return Ok(());
                }
                if ROOTS.contains(&name.as_str()) {
                    let mut path = vec![name.clone()];
                    path.extend(segments.into_iter().rev());
                    references.insert_path(Path::new(path));
                    return Ok(());
                }
                if segments.is_empty() && TYPE_NAMES.contains(&name.as_str()) {
                    return Ok(());
                }
                return Err(ExprError::UnknownName(name.clone()));
            }
            // The base is something else, such as a call or a list: read what is inside it.
            _ => return collect(current, bound, references),
        }
    }
}

fn literal(node: &IdedExpr) -> Option<&LiteralValue> {
    match &node.expr {
        Expr::Literal(value) => Some(value),
        _ => None,
    }
}

/// Whether `node` is `operand['text']`.
fn is_string_index(node: &IdedExpr) -> bool {
    matches!(
        &node.expr,
        Expr::Call(call)
            if call.func_name == "_[_]"
                && call.target.is_none()
                && call.args.len() == 2
                && matches!(literal(&call.args[1]), Some(LiteralValue::String(_)))
    )
}

fn to_cel(value: &Value) -> CelValue {
    match value {
        Value::Null => CelValue::Null,
        Value::Bool(flag) => CelValue::Bool(*flag),
        Value::Number(number) => number
            .as_i64()
            .map(CelValue::Int)
            .or_else(|| number.as_u64().map(CelValue::UInt))
            .unwrap_or_else(|| CelValue::Float(number.as_f64().unwrap_or(f64::NAN))),
        Value::String(text) => CelValue::String(Arc::new(text.clone())),
        Value::Array(items) => CelValue::List(Arc::new(items.iter().map(to_cel).collect())),
        Value::Object(map) => CelValue::from(
            map.iter()
                .map(|(key, item)| (key.clone(), to_cel(item)))
                .collect::<HashMap<_, _>>(),
        ),
    }
}

/// Converts a result to data, spending `budget` bytes of text. Bytes, functions and anything else
/// that is not plain data are an error.
fn spend(budget: &mut usize, len: usize) -> Result<(), ExprError> {
    *budget = budget.checked_sub(len).ok_or(ExprError::ResultTooLarge)?;
    Ok(())
}

fn to_json(value: &CelValue, budget: &mut usize) -> Result<Value, ExprError> {
    Ok(match value {
        CelValue::Null => Value::Null,
        CelValue::Bool(flag) => Value::Bool(*flag),
        CelValue::Int(number) => Value::from(*number),
        CelValue::UInt(number) => Value::from(*number),
        CelValue::Float(number) => Value::Number(
            serde_json::Number::from_f64(*number)
                .ok_or(ExprError::UnsupportedResult("not a finite number"))?,
        ),
        CelValue::String(text) => {
            spend(budget, text.len())?;
            Value::String(text.as_ref().clone())
        }
        CelValue::List(items) => {
            spend(budget, items.len())?;
            Value::Array(
                items
                    .iter()
                    .map(|item| to_json(item, budget))
                    .collect::<Result<_, _>>()?,
            )
        }
        CelValue::Map(map) => {
            let mut out = serde_json::Map::new();
            for (key, item) in map.map.iter() {
                let key = match CelValue::from(key) {
                    CelValue::String(text) => text.as_ref().clone(),
                    CelValue::Int(number) => number.to_string(),
                    CelValue::UInt(number) => number.to_string(),
                    CelValue::Bool(flag) => flag.to_string(),
                    _ => return Err(ExprError::UnsupportedResult("a map key is not text")),
                };
                spend(budget, key.len())?;
                out.insert(key, to_json(item, budget)?);
            }
            Value::Object(out)
        }
        _ => {
            return Err(ExprError::UnsupportedResult(
                "bytes and functions cannot be used",
            ));
        }
    })
}

/// A message without the values involved, which may be text from Discord users.
fn describe(error: ExecutionError) -> ExprError {
    let text = match &error {
        ExecutionError::NoSuchKey(key) => format!("no such key `{key}`"),
        ExecutionError::UndeclaredReference(name) => format!("`{name}` is not available here"),
        ExecutionError::DivisionByZero(_) => "division by zero".to_owned(),
        ExecutionError::RemainderByZero(_) => "remainder by zero".to_owned(),
        ExecutionError::Overflow(operator, _, _) => format!("overflow in `{operator}`"),
        ExecutionError::IndexOutOfBounds(_) => "index out of bounds".to_owned(),
        ExecutionError::UnexpectedType { got, want } => {
            format!("got {got}, expected {want}")
        }
        ExecutionError::NoSuchOverload(overload) => format!(
            "`{}` does not accept ({})",
            overload.function(),
            overload.argument_types().join(", ")
        ),
        ExecutionError::ValuesNotComparable(_, _) => "these values cannot be compared".to_owned(),
        ExecutionError::UnsupportedBinaryOperator(operator, _, _) => {
            format!("`{operator}` does not accept these values")
        }
        _ => "the expression cannot be evaluated with these values".to_owned(),
    };
    ExprError::Evaluation(short(&text))
}

fn short(text: &str) -> String {
    const MAX: usize = 200;
    match text.char_indices().nth(MAX) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_owned(),
    }
}

#[cfg(test)]
pub(super) fn allowed_functions() -> &'static [&'static str] {
    ALLOWED_FUNCTIONS
}
