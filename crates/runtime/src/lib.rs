//! The node catalog, validation, compile, expressions and the run executor.
//!
//! This crate knows no Tauri, Discord or SQLite: it only sees the `Platform` and `Storage`
//! traits (`docs/ARCHITECTURE.md` §2).

pub mod catalog;
pub mod compile;
pub mod expr;
mod nodes;
pub mod platform;
pub mod run;
