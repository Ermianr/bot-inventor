//! The node catalog, validation, compile, expressions and the run executor.
//!
//! This crate knows no Tauri, Discord or SQLite: it only sees the `Platform` and `Storage`
//! traits (`docs/ARCHITECTURE.md` §2).

/// The data types that appear in the API of this crate: a payload, a variable, a project.
pub use graph;

pub mod catalog;
pub mod compile;
pub mod condition;
pub mod expr;
mod nodes;
pub mod platform;
pub mod rename;
pub mod run;
pub mod storage;
