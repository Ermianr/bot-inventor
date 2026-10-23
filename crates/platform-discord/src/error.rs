//! The errors of the adapter. They are closed lists that carry no text from Discord, which may
//! hold what users wrote, and never the token.

/// Why the adapter could not start or keep going.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AdapterError {
    #[error("the payload asks for the gateway intent `{0}`, which this version does not know")]
    UnknownIntent(String),
    #[error("the payload asks for the cache resource `{0}`, which this version does not know")]
    UnknownCache(String),
    #[error("the command `{0}` is not a slash command the adapter can register")]
    UnsupportedCommand(String),
    #[error("Discord rejected the bot token: check `DISCORD_TOKEN` in `.env`")]
    InvalidToken,
    #[error("`DISCORD_DEV_GUILD_ID` is not a server id")]
    InvalidGuildId,
    #[error("Discord answered with the status {0}")]
    Api(u16),
    #[error("could not reach Discord")]
    Network,
    #[error("the gateway connection was closed and cannot be resumed")]
    GatewayClosed,
}

impl AdapterError {
    /// What a failed request means for the adapter, without any text from the answer.
    pub(crate) fn from_http(error: &twilight_http::Error) -> Self {
        match error.kind() {
            twilight_http::error::ErrorType::Unauthorized => Self::InvalidToken,
            twilight_http::error::ErrorType::Response { status, .. } => match status.get() {
                401 => Self::InvalidToken,
                other => Self::Api(other),
            },
            _ => Self::Network,
        }
    }
}

/// What a failed request means for a flow: a 403 is a missing permission, the rest is a failure.
pub(crate) fn platform_error(error: &twilight_http::Error) -> runtime::platform::PlatformError {
    use runtime::platform::PlatformError;
    match error.kind() {
        twilight_http::error::ErrorType::Response { status, .. } if status.get() == 403 => {
            PlatformError::MissingPermissions
        }
        _ => PlatformError::Failed,
    }
}
