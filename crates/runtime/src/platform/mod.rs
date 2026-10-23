//! The `Platform` trait: what the runtime sees of Discord (`docs/ARCHITECTURE.md` §7).
//!
//! The platform delivers normalized [`Event`]s and carries out actions. `platform-discord`
//! implements it on twilight; [`MockPlatform`] implements it for tests and records every action.
//! The runtime never sees a token or a network type.

mod mock;

use std::future::Future;

use serde_json::Value;

pub use mock::{Action, MockPlatform};

/// Something that happened on the platform, in the shape the runtime reads.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// The kind of event, as the event table of the payload names it (`slash_command`).
    pub kind: String,
    /// For a slash command, the name of the command that was used.
    pub command: Option<String>,
    /// The fields the flow reads as `event.*`. Discord ids are text.
    pub data: Value,
    /// What a reply goes to, when the event is an interaction.
    pub interaction: Option<Interaction>,
}

/// A handle to an interaction waiting for a response. The token stays in the platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interaction {
    pub id: String,
}

/// Whether a reply is the first response to an interaction or comes after it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Response,
    FollowUp,
}

/// Who a message may notify. Nobody, unless a node says otherwise.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AllowedMentions {
    pub users: bool,
    pub roles: bool,
}

/// A message sent to an interaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub interaction: Interaction,
    pub content: String,
    pub ephemeral: bool,
    pub mentions: AllowedMentions,
    pub delivery: Delivery,
}

/// Why an action failed. Closed, and it carries no data from the platform, which may hold text
/// written by users.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PlatformError {
    #[error("the bot does not have the permission for this action")]
    MissingPermissions,
    #[error("the platform could not carry out the action")]
    Failed,
}

/// The actions a flow can ask of the platform.
pub trait Platform: Send + Sync + 'static {
    /// Tells the user the bot is working on the response, so the platform's deadline for a first
    /// response stops running. The next [`Reply`] to the interaction completes it, and it is
    /// visible only to the user when `ephemeral` is set.
    fn defer(
        &self,
        interaction: Interaction,
        ephemeral: bool,
    ) -> impl Future<Output = Result<(), PlatformError>> + Send;

    /// Sends `reply` and returns the id of the message.
    fn reply(&self, reply: Reply) -> impl Future<Output = Result<String, PlatformError>> + Send;
}
