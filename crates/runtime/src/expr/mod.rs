//! Expressions and templates (`docs/ARCHITECTURE.md` §4.2 and §6).
//!
//! An expression is CEL source written by the bot's author. A template is plain text with
//! `{{ expression }}` segments. Both are compiled once and evaluated many times against a
//! [`Scope`]. Text that comes from Discord users reaches an evaluation only as data inside the
//! scope: it is never compiled.
//!
//! The rest of the crate sees only the [`ExpressionEngine`] trait; the `cel` crate is used from
//! [`cel_engine`] and nowhere else.

mod cel_engine;
mod error;
mod lex;
mod limits;
mod references;
mod scope;
mod syntax;
mod template;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_rename;
#[cfg(test)]
mod tests_syntax;

pub use cel_engine::CelEngine;
pub use error::ExprError;
pub use limits::{
    MAX_COLLECTION_LEN, MAX_COMPREHENSION_NESTING, MAX_DEPTH, MAX_NODES, MAX_OPERATORS,
    MAX_RESULT_BYTES, MAX_SCOPE_BYTES, MAX_SCOPE_DEPTH, MAX_SCOPE_ITEMS, MAX_SOURCE_BYTES,
    MAX_TEMPLATE_BYTES,
};
pub use references::{Path, ROOTS, References};
pub use scope::Scope;
pub use syntax::{Binary, Method, Syntax, is_identifier, name_source, quote};
pub use template::{Template, rename_step_in_template};

pub use serde_json::Value;

/// A compiled expression, shared across runs.
pub trait Expression: Send + Sync {
    /// The names this expression reads and the functions it calls.
    fn references(&self) -> &References;

    /// Evaluates the expression. A type mistake or a missing key is an error, never a panic.
    fn evaluate(&self, scope: &Scope) -> Result<Value, ExprError>;
}

/// Turns source text into compiled expressions.
pub trait ExpressionEngine: Send + Sync {
    /// Parses and checks `source`: its length, its shape, the names it reads and the functions it
    /// calls. Nothing is evaluated.
    fn compile(&self, source: &str) -> Result<Box<dyn Expression>, ExprError>;

    /// Parses `source` as `compile` does and describes it for the condition builder. A part the
    /// builder does not know is [`Syntax::Other`]; it is never an error.
    fn syntax(&self, source: &str) -> Result<Syntax, ExprError>;

    /// Rewrites every read of `steps.<from>` in `source` to `steps.<to>`, found in the syntax
    /// tree and not by searching the text: a string, a field of another name or a longer alias
    /// is left alone. `None` when nothing reads `steps.<from>`. `to` must be a valid alias.
    ///
    /// # Errors
    ///
    /// When `source` does not compile, when the result would not, or when a read cannot be
    /// rewritten with certainty. The source is never half rewritten.
    fn rename_step(&self, source: &str, from: &str, to: &str) -> Result<Option<String>, ExprError>;
}
