//! `runner`: the binary that runs a bot (`docs/ARCHITECTURE.md` §9).
//!
//! It reads a payload (from `--payload`, the environment or the end of its own executable),
//! reads the token from `.env`, wires the runtime to Discord and SQLite, and writes JSON lines
//! on standard output. The same code runs a bot for a local run and for an exported bot.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::panic))]

pub mod app;
pub mod args;
pub mod assets;
pub mod data;
pub mod env;
pub mod failure;
pub mod log;
pub mod source;
pub mod time;

pub use app::{GRACE, execute};
pub use args::{Args, Command, parse};
pub use env::Settings;
pub use failure::Failure;
