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
mod template;

#[cfg(test)]
mod tests;

pub use cel_engine::CelEngine;
pub use error::ExprError;
pub use limits::{
    MAX_COLLECTION_LEN, MAX_COMPREHENSION_NESTING, MAX_DEPTH, MAX_NODES, MAX_OPERATORS,
    MAX_RESULT_BYTES, MAX_SCOPE_BYTES, MAX_SCOPE_DEPTH, MAX_SCOPE_ITEMS, MAX_SOURCE_BYTES,
    MAX_TEMPLATE_BYTES,
};
pub use references::{Path, ROOTS, References};
pub use scope::Scope;
pub use template::Template;

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
}
