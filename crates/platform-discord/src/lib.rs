//! `platform-discord`: the `Platform` implementation on twilight (`docs/ARCHITECTURE.md` §7).
//!
//! This crate is the only one besides the runner that knows Discord. It turns gateway
//! interactions into the runtime's events, sends the runtime's actions as requests, registers
//! the bot's slash commands and keeps the token out of everything it prints.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::panic))]

pub mod commands;
mod error;
pub mod event;
mod gateway;
pub mod intents;
mod interactions;
mod platform;
#[cfg(test)]
mod testing;
mod tls;
mod token;

pub use error::AdapterError;
pub use gateway::{Discord, check_guild_id};
pub use platform::DiscordPlatform;
pub use token::Token;
