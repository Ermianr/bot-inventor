//! The `Platform` implementation: the runtime's actions as Discord requests.

use std::fmt;
use std::sync::Arc;

use runtime::platform::{AllowedMentions, Delivery, Interaction, Platform, PlatformError, Reply};
use twilight_http::Client;
use twilight_model::channel::message::{
    AllowedMentions as DiscordMentions, MentionType, MessageFlags,
};
use twilight_model::http::interaction::{
    InteractionResponse, InteractionResponseData, InteractionResponseType,
};
use twilight_model::id::Id;
use twilight_model::id::marker::{ApplicationMarker, InteractionMarker};

use crate::error::platform_error;
use crate::interactions::Interactions;

/// Sends the actions of a run to Discord. It is cheap to clone.
#[derive(Clone)]
pub struct DiscordPlatform {
    pub(crate) client: Arc<Client>,
    pub(crate) application: Id<ApplicationMarker>,
    pub(crate) interactions: Arc<Interactions>,
}

impl fmt::Debug for DiscordPlatform {
    /// Shows nothing of the client, which holds the token.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DiscordPlatform")
            .field("application", &self.application)
            .finish_non_exhaustive()
    }
}

fn interaction_id(interaction: &Interaction) -> Option<Id<InteractionMarker>> {
    interaction.id.parse::<u64>().ok().and_then(Id::new_checked)
}

/// Nobody is notified unless the node says so; `@everyone` and `@here` never are.
fn mentions(allowed: AllowedMentions) -> DiscordMentions {
    let mut parse = Vec::new();
    if allowed.users {
        parse.push(MentionType::Users);
    }
    if allowed.roles {
        parse.push(MentionType::Roles);
    }
    DiscordMentions {
        parse,
        ..DiscordMentions::default()
    }
}

fn flags(ephemeral: bool) -> MessageFlags {
    if ephemeral {
        MessageFlags::EPHEMERAL
    } else {
        MessageFlags::empty()
    }
}

impl Platform for DiscordPlatform {
    async fn defer(&self, interaction: Interaction, ephemeral: bool) -> Result<(), PlatformError> {
        let id = interaction_id(&interaction).ok_or(PlatformError::Failed)?;
        let waiting = self
            .interactions
            .waiting(&interaction.id)
            .ok_or(PlatformError::Failed)?;
        let response = InteractionResponse {
            kind: InteractionResponseType::DeferredChannelMessageWithSource,
            data: ephemeral.then(|| InteractionResponseData {
                flags: Some(flags(true)),
                ..InteractionResponseData::default()
            }),
        };
        self.client
            .interaction(self.application)
            .create_response(id, &waiting.token, &response)
            .await
            .map_err(|error| platform_error(&error))?;
        self.interactions.set_deferred(&interaction.id, true);
        Ok(())
    }

    async fn reply(&self, reply: Reply) -> Result<String, PlatformError> {
        let id = interaction_id(&reply.interaction).ok_or(PlatformError::Failed)?;
        let waiting = self
            .interactions
            .waiting(&reply.interaction.id)
            .ok_or(PlatformError::Failed)?;
        let client = self.client.interaction(self.application);
        let mentions = mentions(reply.mentions);
        let failed = |_| PlatformError::Failed;

        let message = match (reply.delivery, waiting.deferred) {
            (Delivery::Response, _) => {
                let response = InteractionResponse {
                    kind: InteractionResponseType::ChannelMessageWithSource,
                    data: Some(InteractionResponseData {
                        allowed_mentions: Some(mentions),
                        content: Some(reply.content),
                        flags: Some(flags(reply.ephemeral)),
                        ..InteractionResponseData::default()
                    }),
                };
                client
                    .create_response(id, &waiting.token, &response)
                    .await
                    .map_err(|error| platform_error(&error))?;
                // The answer to a response has no body; the message is asked for. The response
                // is already sent, so a failure here only leaves the id empty.
                return Ok(match client.response(&waiting.token).await {
                    Ok(message) => message
                        .model()
                        .await
                        .map(|message| message.id.get().to_string())
                        .unwrap_or_default(),
                    Err(_) => String::new(),
                });
            }
            // The first message after a deferral replaces "thinking".
            (Delivery::FollowUp, true) => {
                let message = client
                    .update_response(&waiting.token)
                    .content(Some(&reply.content))
                    .allowed_mentions(Some(&mentions))
                    .await
                    .map_err(|error| platform_error(&error))?;
                self.interactions.set_deferred(&reply.interaction.id, false);
                message
            }
            (Delivery::FollowUp, false) => client
                .create_followup(&waiting.token)
                .content(&reply.content)
                .flags(flags(reply.ephemeral))
                .allowed_mentions(Some(&mentions))
                .await
                .map_err(|error| platform_error(&error))?,
        };
        let message = message.model().await.map_err(failed)?;
        Ok(message.id.get().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nobody_is_mentioned_unless_a_node_allows_it() {
        let none = mentions(AllowedMentions::default());
        assert!(none.parse.is_empty() && none.users.is_empty() && none.roles.is_empty());
        assert!(!none.replied_user);

        let users = mentions(AllowedMentions {
            users: true,
            roles: false,
        });
        assert_eq!(users.parse, [MentionType::Users]);
        let both = mentions(AllowedMentions {
            users: true,
            roles: true,
        });
        assert_eq!(both.parse, [MentionType::Users, MentionType::Roles]);
        // `@everyone` is never in the list.
        assert!(!both.parse.contains(&MentionType::Everyone));
    }

    #[test]
    fn an_ephemeral_reply_is_flagged() {
        assert_eq!(flags(true), MessageFlags::EPHEMERAL);
        assert_eq!(flags(false), MessageFlags::empty());
    }

    #[test]
    fn an_interaction_id_must_be_a_snowflake() {
        let handle = |id: &str| Interaction { id: id.to_owned() };
        assert!(interaction_id(&handle("123")).is_some());
        for bad in ["", "0", "-1", "abc", "1.5", "99999999999999999999999"] {
            assert!(interaction_id(&handle(bad)).is_none(), "{bad:?}");
        }
    }

    // --- the requests, against a fake Discord ---------------------------------------------

    use crate::testing::{FakeDiscord, message};
    use serde_json::{Value, json};

    const APP: u64 = 1;

    async fn platform(fake: &FakeDiscord) -> DiscordPlatform {
        let interactions = Arc::new(Interactions::default());
        interactions.insert("77".to_owned(), "tok-77".to_owned());
        DiscordPlatform {
            client: Arc::new(fake.client()),
            application: Id::new(APP),
            interactions,
        }
    }

    fn reply(delivery: Delivery, ephemeral: bool) -> Reply {
        Reply {
            interaction: Interaction {
                id: "77".to_owned(),
            },
            content: "Pong!".to_owned(),
            ephemeral,
            mentions: AllowedMentions::default(),
            delivery,
        }
    }

    #[tokio::test]
    async fn the_first_reply_is_the_response_and_its_message_is_looked_up() {
        let fake = FakeDiscord::start().await;
        fake.answer(204, &Value::Null);
        fake.answer(200, &message("555"));
        let id = platform(&fake)
            .await
            .reply(reply(Delivery::Response, false))
            .await;
        assert_eq!(id, Ok("555".to_owned()));

        let seen = fake.seen();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].method, "POST");
        assert!(
            seen[0].path.contains("/interactions/77/tok-77/callback"),
            "{}",
            seen[0].path
        );
        assert_eq!(seen[0].body["type"], 4);
        assert_eq!(seen[0].body["data"]["content"], "Pong!");
        assert_eq!(seen[0].body["data"]["allowed_mentions"]["parse"], json!([]));
        assert_eq!(seen[0].body["data"]["flags"], 0);
        assert_eq!(seen[1].method, "GET");
        assert!(
            seen[1]
                .path
                .ends_with("/webhooks/1/tok-77/messages/@original"),
            "{}",
            seen[1].path
        );
    }

    #[tokio::test]
    async fn an_ephemeral_response_carries_the_flag() {
        let fake = FakeDiscord::start().await;
        fake.answer(204, &Value::Null);
        fake.answer(200, &message("555"));
        platform(&fake)
            .await
            .reply(reply(Delivery::Response, true))
            .await
            .unwrap();
        assert_eq!(fake.seen()[0].body["data"]["flags"], 64);
    }

    #[tokio::test]
    async fn a_failure_to_look_the_message_up_does_not_fail_a_reply_that_was_sent() {
        let fake = FakeDiscord::start().await;
        fake.answer(204, &Value::Null);
        fake.answer(500, &Value::Null);
        let id = platform(&fake)
            .await
            .reply(reply(Delivery::Response, false))
            .await;
        assert_eq!(id, Ok(String::new()));
    }

    #[tokio::test]
    async fn a_deferral_then_two_messages_edits_the_thinking_one_and_then_follows_up() {
        let fake = FakeDiscord::start().await;
        let platform = platform(&fake).await;
        fake.answer(204, &Value::Null);
        platform
            .defer(
                Interaction {
                    id: "77".to_owned(),
                },
                true,
            )
            .await
            .unwrap();
        fake.answer(200, &message("600"));
        let first = platform.reply(reply(Delivery::FollowUp, true)).await;
        fake.answer(200, &message("601"));
        let second = platform.reply(reply(Delivery::FollowUp, true)).await;
        assert_eq!(
            (first, second),
            (Ok("600".to_owned()), Ok("601".to_owned()))
        );

        let seen = fake.seen();
        assert_eq!(seen[0].body["type"], 5);
        assert_eq!(seen[0].body["data"]["flags"], 64);
        assert_eq!(seen[1].method, "PATCH");
        assert!(
            seen[1]
                .path
                .ends_with("/webhooks/1/tok-77/messages/@original"),
            "{}",
            seen[1].path
        );
        assert_eq!(seen[1].body["content"], "Pong!");
        assert_eq!(seen[2].method, "POST");
        assert!(
            seen[2].path.contains("/webhooks/1/tok-77?"),
            "{}",
            seen[2].path
        );
        assert_eq!(seen[2].body["flags"], 64);
        assert_eq!(seen[2].body["allowed_mentions"]["parse"], json!([]));
    }

    #[tokio::test]
    async fn a_public_deferral_has_no_flags() {
        let fake = FakeDiscord::start().await;
        fake.answer(204, &Value::Null);
        platform(&fake)
            .await
            .defer(
                Interaction {
                    id: "77".to_owned(),
                },
                false,
            )
            .await
            .unwrap();
        assert_eq!(fake.seen()[0].body["type"], 5);
        assert!(fake.seen()[0].body.get("data").is_none_or(Value::is_null));
    }

    #[tokio::test]
    async fn a_403_is_a_missing_permission_and_any_other_failure_is_a_failure() {
        for (status, expected) in [
            (403, PlatformError::MissingPermissions),
            (500, PlatformError::Failed),
            (404, PlatformError::Failed),
            (401, PlatformError::Failed),
            (429, PlatformError::Failed),
        ] {
            let fake = FakeDiscord::start().await;
            fake.answer(
                status,
                &json!({ "message": "text from Discord", "code": 50013 }),
            );
            let platform = platform(&fake).await;
            let result = platform.reply(reply(Delivery::Response, false)).await;
            assert_eq!(result, Err(expected), "status {status}");
        }
    }

    #[tokio::test]
    async fn an_unknown_or_malformed_interaction_fails_without_a_request() {
        let fake = FakeDiscord::start().await;
        let platform = platform(&fake).await;
        let mut unknown = reply(Delivery::Response, false);
        unknown.interaction.id = "78".to_owned();
        assert_eq!(platform.reply(unknown).await, Err(PlatformError::Failed));
        let mut bad = reply(Delivery::Response, false);
        bad.interaction.id = "not an id".to_owned();
        assert_eq!(platform.reply(bad).await, Err(PlatformError::Failed));
        assert_eq!(
            platform
                .defer(
                    Interaction {
                        id: "78".to_owned()
                    },
                    false
                )
                .await,
            Err(PlatformError::Failed)
        );
        assert!(fake.seen().is_empty());
    }

    #[tokio::test]
    async fn content_past_the_limit_is_a_failure_and_sends_nothing() {
        let fake = FakeDiscord::start().await;
        let platform = platform(&fake).await;
        let mut long = reply(Delivery::FollowUp, false);
        long.content = "x".repeat(2001);
        assert_eq!(platform.reply(long).await, Err(PlatformError::Failed));
        assert!(fake.seen().is_empty());
    }

    #[tokio::test]
    async fn neither_the_debug_output_nor_an_error_shows_the_tokens() {
        let fake = FakeDiscord::start().await;
        let platform = platform(&fake).await;
        let shown = format!("{platform:?} {:?}", platform.interactions);
        assert!(!shown.contains("fake-token-value"), "{shown}");
        assert!(!shown.contains("tok-77"), "{shown}");

        fake.answer(403, &json!({ "message": "Missing Access" }));
        let error = platform
            .reply(reply(Delivery::Response, false))
            .await
            .unwrap_err();
        let shown = format!("{error:?} {error}");
        assert!(!shown.contains("fake-token-value") && !shown.contains("tok-77"));
        assert!(!shown.contains("Missing Access"));
    }
}
