//! The connection to Discord: the gateway loop that feeds the runtime, and the start-up that
//! checks the token and registers the commands.

use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::time::Duration;

use runtime::graph::{CommandDef, Requirements};
use runtime::run::{Level, LogRecord, RunLog, Runtime};
use runtime::storage::Storage;
use twilight_cache_inmemory::DefaultInMemoryCache;
use twilight_gateway::{CloseFrame, Event, EventTypeFlags, Shard, ShardId, StreamExt as _};
use twilight_http::Client;
use twilight_model::id::Id;
use twilight_model::id::marker::{ApplicationMarker, GuildMarker};

use crate::commands::{self, SyncReport, Target, Wanted};
use crate::event::{NormalizeError, normalize};
use crate::interactions::Interactions;
use crate::{AdapterError, DiscordPlatform, Token, intents};

/// Seconds to wait before the first retry after an error, and the most to wait. The gateway
/// closes a bot that reconnects in a tight loop, and a token is reset after too many identifies.
const FIRST_PAUSE: Duration = Duration::from_secs(1);
const LONGEST_PAUSE: Duration = Duration::from_secs(60);

/// How long a closing connection may take to finish.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

/// A connection to Discord that has not started to listen.
pub struct Discord {
    client: Arc<Client>,
    application: Id<ApplicationMarker>,
    interactions: Arc<Interactions>,
    shard: Shard,
    events: EventTypeFlags,
    cache: Option<DefaultInMemoryCache>,
}

impl std::fmt::Debug for Discord {
    /// Shows nothing of the client or the shard, which hold the token.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Discord")
            .field("application", &self.application)
            .finish_non_exhaustive()
    }
}

impl Discord {
    /// Prepares the connection for what the payload asks, and checks the token with one
    /// request. Nothing is enabled beyond `requirements`.
    ///
    /// # Errors
    ///
    /// [`AdapterError`] for a name in `requirements` this version does not know, a token
    /// Discord rejects, or no connection.
    pub async fn connect(
        token: &Token,
        requirements: &Requirements,
    ) -> Result<(Self, DiscordPlatform), AdapterError> {
        let intents = intents::intents(&requirements.intents)?;
        crate::tls::install();
        let cache = intents::cache(&requirements.cache)?;
        let client = Arc::new(Client::new(token.expose().to_owned()));
        let application = client
            .current_user_application()
            .await
            .map_err(|error| AdapterError::from_http(&error))?
            .model()
            .await
            .map_err(|_| AdapterError::Network)?
            .id;
        let interactions = Arc::new(Interactions::default());
        let platform = DiscordPlatform {
            client: Arc::clone(&client),
            application,
            interactions: Arc::clone(&interactions),
        };
        let discord = Self {
            client,
            application,
            interactions,
            shard: Shard::new(ShardId::ONE, token.expose().to_owned(), intents),
            events: intents::event_types(cache.is_some()),
            cache,
        };
        Ok((discord, platform))
    }

    /// Registers the commands of the payload: for the whole app, or only in `dev_guild` (a
    /// server id) when there is one. It sends only what differs from what is registered.
    ///
    /// # Errors
    ///
    /// [`AdapterError`] for a server id that is not one, a command that cannot be registered or
    /// a request that fails.
    pub async fn sync_commands(
        &self,
        dev_guild: Option<&str>,
        definitions: &[CommandDef],
    ) -> Result<SyncReport, AdapterError> {
        let target = match dev_guild {
            None => Target::Global,
            Some(guild) => Target::Guild(guild_id(guild)?),
        };
        let wanted: Vec<Wanted> = definitions
            .iter()
            .map(|command| Wanted {
                name: command.name.clone(),
                definition: command.definition.clone(),
            })
            .collect();
        commands::sync(&self.client, self.application, target, &wanted).await
    }

    /// Listens to the gateway and hands every slash command to `runtime` until `stop` is ready,
    /// then closes the connection. The loop only normalizes and dispatches: a flow never runs
    /// inside it. twilight reconnects by itself; after an error the loop waits longer each
    /// time, up to a minute.
    ///
    /// # Errors
    ///
    /// [`AdapterError::GatewayClosed`] when Discord closes the connection for good (a rejected
    /// token or intents the app has not been given).
    pub async fn run<S: Storage>(
        mut self,
        runtime: &Runtime<DiscordPlatform, S>,
        log: &dyn RunLog,
        stop: impl Future<Output = ()>,
    ) -> Result<(), AdapterError> {
        let mut stop = pin!(stop);
        let mut pause = Pause::default();
        loop {
            let item = tokio::select! {
                () = &mut stop => break,
                item = self.shard.next_event(self.events) => item,
            };
            let event = match item {
                None => return Err(AdapterError::GatewayClosed),
                Some(Ok(event)) => {
                    pause.reset();
                    event
                }
                Some(Err(_)) => {
                    // The error can quote the event, which holds text from users: it is not logged.
                    warn(log, "the gateway could not be read; trying again");
                    tokio::select! {
                        () = &mut stop => break,
                        () = tokio::time::sleep(pause.next()) => continue,
                    }
                }
            };
            if let Some(cache) = &self.cache {
                cache.update(&event);
            }
            match event {
                Event::InteractionCreate(interaction) => {
                    self.interaction(runtime, log, &interaction);
                }
                Event::GatewayClose(_) => warn(log, "the gateway connection closed"),
                _ => {}
            }
        }
        self.shard.close(CloseFrame::NORMAL);
        // The stream does not end after a close: it reports it and then reconnects. Stop at the
        // report, so the shard never identifies again.
        let _ = tokio::time::timeout(CLOSE_TIMEOUT, async {
            while let Some(item) = self.shard.next_event(EventTypeFlags::empty()).await {
                if matches!(item, Ok(Event::GatewayClose(_))) {
                    break;
                }
            }
        })
        .await;
        Ok(())
    }

    fn interaction<S: Storage>(
        &self,
        runtime: &Runtime<DiscordPlatform, S>,
        log: &dyn RunLog,
        interaction: &twilight_model::application::interaction::Interaction,
    ) {
        match normalize(interaction) {
            Ok(normalized) => {
                let id = interaction.id.get().to_string();
                self.interactions.insert(id.clone(), normalized.token);
                if runtime.dispatch(normalized.event).started == 0 {
                    self.interactions.forget(&id);
                }
            }
            Err(NormalizeError::NotASlashCommand) => {}
            Err(NormalizeError::Malformed) => {
                warn(
                    log,
                    "an interaction was dropped: it does not have the expected shape",
                );
            }
        }
    }
}

fn warn(log: &dyn RunLog, message: &str) {
    log.record(LogRecord {
        level: Level::Warn,
        flow: None,
        node: None,
        message: message.to_owned(),
    });
}

/// A server id: digits only, as Discord ids are.
fn guild_id(text: &str) -> Result<Id<GuildMarker>, AdapterError> {
    if text.is_empty() || text.len() > 20 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AdapterError::InvalidGuildId);
    }
    text.parse::<u64>()
        .ok()
        .and_then(Id::new_checked)
        .ok_or(AdapterError::InvalidGuildId)
}

/// How long to wait after each error in a row: one second, doubling up to a minute.
#[derive(Debug, Default)]
struct Pause {
    errors: u32,
}

impl Pause {
    fn next(&mut self) -> Duration {
        let wait = FIRST_PAUSE
            .saturating_mul(2u32.saturating_pow(self.errors))
            .min(LONGEST_PAUSE);
        self.errors = self.errors.saturating_add(1);
        wait
    }

    fn reset(&mut self) {
        self.errors = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pause_doubles_up_to_a_minute_and_starts_over_after_an_event() {
        let mut pause = Pause::default();
        let waits: Vec<u64> = (0..9).map(|_| pause.next().as_secs()).collect();
        assert_eq!(waits, [1, 2, 4, 8, 16, 32, 60, 60, 60]);
        pause.reset();
        assert_eq!(pause.next(), FIRST_PAUSE);
    }

    #[test]
    fn the_pause_never_overflows() {
        let mut pause = Pause { errors: u32::MAX };
        assert_eq!(pause.next(), LONGEST_PAUSE);
        assert_eq!(pause.errors, u32::MAX);
    }

    #[test]
    fn a_dev_guild_is_a_snowflake() {
        assert_eq!(
            guild_id("123456789012345678").unwrap().get(),
            123_456_789_012_345_678
        );
        for bad in [
            "",
            "0",
            "-1",
            " 1",
            "1 ",
            "abc",
            "1e3",
            "999999999999999999999",
        ] {
            assert_eq!(guild_id(bad), Err(AdapterError::InvalidGuildId), "{bad:?}");
        }
    }
}
