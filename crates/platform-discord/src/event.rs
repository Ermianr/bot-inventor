//! From a gateway interaction to the runtime's [`Event`] (`docs/ARCHITECTURE.md` §7).
//!
//! Everything in an interaction was written by a user or by Discord, so it is read as data:
//! sizes are checked, Discord ids become text, and what does not fit gives an error, never a
//! panic. The interaction token is returned apart from the event and stays in the adapter.

use runtime::platform::{Event, Interaction};
use serde_json::{Map, Number, Value, json};
use twilight_model::application::command::CommandType;
use twilight_model::application::interaction::application_command::{
    CommandDataOption, CommandOptionValue,
};
use twilight_model::application::interaction::{
    Interaction as GatewayInteraction, InteractionData, InteractionType,
};
use twilight_model::util::Timestamp;

/// Discord names are 32 characters at most.
const MAX_NAME_CHARS: usize = 32;
/// A command has 25 options at most.
const MAX_OPTIONS: usize = 25;
/// The longest text an option can carry.
const MAX_TEXT_CHARS: usize = 6000;
/// Milliseconds from 1970 to the first second of 2015, the start of Discord's ids.
const DISCORD_EPOCH_MS: u64 = 1_420_070_400_000;

/// An interaction ready for the runtime.
#[derive(Debug, Clone, PartialEq)]
pub struct Normalized {
    pub event: Event,
    /// The token that answers the interaction. It must not appear in any output.
    pub(crate) token: String,
}

/// Why an interaction does not become an event. Closed, with no data from the interaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum NormalizeError {
    /// Not a slash command: a button, a ping or a command of another kind.
    #[error("the interaction is not a slash command")]
    NotASlashCommand,
    /// A slash command that does not have the shape the adapter reads.
    #[error("the slash command does not have the expected shape")]
    Malformed,
}

/// Turns a slash command interaction into an [`Event`] of kind `slash_command`, with
/// `event.command.name`, `event.user`, `event.member` and `event.guild` (in a server),
/// `event.channel`, `event.timestamp` and `event.options`.
///
/// # Errors
///
/// [`NormalizeError`] when the interaction is not a slash command or is malformed.
pub fn normalize(interaction: &GatewayInteraction) -> Result<Normalized, NormalizeError> {
    if interaction.kind != InteractionType::ApplicationCommand {
        return Err(NormalizeError::NotASlashCommand);
    }
    let Some(InteractionData::ApplicationCommand(data)) = &interaction.data else {
        return Err(NormalizeError::Malformed);
    };
    if data.kind != CommandType::ChatInput {
        return Err(NormalizeError::NotASlashCommand);
    }
    let name_length = data.name.chars().count();
    if name_length == 0 || name_length > MAX_NAME_CHARS {
        return Err(NormalizeError::Malformed);
    }
    let user = interaction.author().ok_or(NormalizeError::Malformed)?;

    let mut event = Map::new();
    event.insert("command".to_owned(), json!({ "name": data.name }));
    event.insert(
        "user".to_owned(),
        json!({ "id": user.id.get().to_string(), "name": user.name }),
    );
    if let Some(member) = &interaction.member {
        let roles: Vec<String> = member
            .roles
            .iter()
            .map(|role| role.get().to_string())
            .collect();
        let permissions: Vec<&str> = member
            .permissions
            .iter()
            .flat_map(|permissions| permissions.iter_names().map(|(name, _)| name))
            .collect();
        event.insert(
            "member".to_owned(),
            json!({ "roles": roles, "permissions": permissions }),
        );
    }
    if let Some(guild) = interaction.guild_id {
        event.insert("guild".to_owned(), json!({ "id": guild.get().to_string() }));
    }
    if let Some(channel) = &interaction.channel {
        event.insert(
            "channel".to_owned(),
            json!({ "id": channel.id.get().to_string() }),
        );
    }
    event.insert("timestamp".to_owned(), Value::String(sent_at(interaction)?));
    event.insert("options".to_owned(), options(&data.options)?);

    Ok(Normalized {
        event: Event {
            kind: "slash_command".to_owned(),
            command: Some(data.name.clone()),
            data: Value::Object(event),
            interaction: Some(Interaction {
                id: interaction.id.get().to_string(),
            }),
        },
        token: interaction.token.clone(),
    })
}

/// When the interaction was created, from its id: an id holds the milliseconds since the start
/// of 2015 in everything above its lowest 22 bits.
fn sent_at(interaction: &GatewayInteraction) -> Result<String, NormalizeError> {
    let milliseconds = (interaction.id.get() >> 22) + DISCORD_EPOCH_MS;
    let microseconds = i64::try_from(milliseconds)
        .ok()
        .and_then(|milliseconds| milliseconds.checked_mul(1000))
        .ok_or(NormalizeError::Malformed)?;
    Timestamp::from_micros(microseconds)
        .map(|timestamp| timestamp.iso_8601().to_string())
        .map_err(|_| NormalizeError::Malformed)
}

/// The options as `{ name: value }`. Users, channels and roles are their ids as text. A command
/// the editor defines has options of those kinds, text, numbers and booleans only.
fn options(options: &[CommandDataOption]) -> Result<Value, NormalizeError> {
    if options.len() > MAX_OPTIONS {
        return Err(NormalizeError::Malformed);
    }
    let mut map = Map::new();
    for option in options {
        let length = option.name.chars().count();
        if length == 0 || length > MAX_NAME_CHARS {
            return Err(NormalizeError::Malformed);
        }
        let value = match &option.value {
            CommandOptionValue::String(text) => {
                if text.chars().count() > MAX_TEXT_CHARS {
                    return Err(NormalizeError::Malformed);
                }
                Value::String(text.clone())
            }
            CommandOptionValue::Integer(number) => Value::Number(Number::from(*number)),
            CommandOptionValue::Number(number) => Number::from_f64(*number)
                .map_or(Err(NormalizeError::Malformed), |n| Ok(Value::Number(n)))?,
            CommandOptionValue::Boolean(flag) => Value::Bool(*flag),
            CommandOptionValue::User(id) => Value::String(id.get().to_string()),
            CommandOptionValue::Channel(id) => Value::String(id.get().to_string()),
            CommandOptionValue::Role(id) => Value::String(id.get().to_string()),
            _ => return Err(NormalizeError::Malformed),
        };
        if map.insert(option.name.clone(), value).is_some() {
            return Err(NormalizeError::Malformed);
        }
    }
    Ok(Value::Object(map))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A `/kick` used by user 42 in server 7, with the given options.
    fn interaction(options: Value) -> Value {
        json!({
            "id": "1234567890123456789",
            "application_id": "1",
            "type": 2,
            "token": "interaction-token-value",
            "version": 1,
            "entitlements": [],
            "authorizing_integration_owners": {},
            "guild_id": "7",
            "channel": { "id": "9", "type": 0 },
            "member": {
                "user": { "id": "42", "username": "ana", "discriminator": "0", "avatar": null },
                "roles": ["100", "200"],
                "permissions": "6",
                "flags": 0,
                "joined_at": "2020-01-01T00:00:00.000000+00:00",
                "deaf": false,
                "mute": false,
                "communication_disabled_until": null,
                "nick": null
            },
            "data": { "id": "5", "name": "kick", "type": 1, "options": options },
        })
    }

    fn parse(value: Value) -> GatewayInteraction {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_slash_command_becomes_an_event() {
        let options = json!([
            { "name": "target", "type": 6, "value": "55" },
            { "name": "reason", "type": 3, "value": "spam" },
            { "name": "days", "type": 4, "value": 3 },
            { "name": "ratio", "type": 10, "value": 0.5 },
            { "name": "silent", "type": 5, "value": true },
        ]);
        let normalized = normalize(&parse(interaction(options))).unwrap();
        let event = normalized.event;
        assert_eq!(event.kind, "slash_command");
        assert_eq!(event.command.as_deref(), Some("kick"));
        assert_eq!(
            event.interaction,
            Some(Interaction {
                id: "1234567890123456789".to_owned()
            })
        );
        let data = &event.data;
        assert_eq!(data["command"]["name"], "kick");
        assert_eq!(data["user"], json!({ "id": "42", "name": "ana" }));
        assert_eq!(data["guild"]["id"], "7");
        assert_eq!(data["channel"]["id"], "9");
        assert_eq!(data["member"]["roles"], json!(["100", "200"]));
        assert_eq!(
            data["member"]["permissions"],
            json!(["KICK_MEMBERS", "BAN_MEMBERS"])
        );
        assert_eq!(
            data["options"],
            json!({
                "target": "55", "reason": "spam", "days": 3, "ratio": 0.5, "silent": true
            })
        );
        assert!(data["timestamp"].as_str().unwrap().starts_with("20"));
        assert_eq!(normalized.token, "interaction-token-value");
    }

    #[test]
    fn the_token_is_not_in_the_event() {
        let normalized = normalize(&parse(interaction(json!([])))).unwrap();
        let shown = format!("{:?}", normalized.event);
        assert!(!shown.contains("interaction-token-value"));
    }

    #[test]
    fn the_timestamp_comes_from_the_id() {
        // 175928847299117063 is the example snowflake of Discord's documentation: 2016-04-30.
        let mut value = interaction(json!([]));
        value["id"] = json!("175928847299117063");
        let event = normalize(&parse(value)).unwrap().event;
        assert!(
            event.data["timestamp"]
                .as_str()
                .unwrap()
                .starts_with("2016-04-30T11:18:25")
        );
    }

    #[test]
    fn a_direct_message_has_no_guild_and_no_member() {
        let mut value = interaction(json!([]));
        let object = value.as_object_mut().unwrap();
        object.remove("guild_id");
        object.remove("member");
        object.insert(
            "user".to_owned(),
            json!({ "id": "42", "username": "ana", "discriminator": "0", "avatar": null }),
        );
        let event = normalize(&parse(value)).unwrap().event;
        assert_eq!(event.data["user"]["id"], "42");
        assert!(event.data.get("guild").is_none());
        assert!(event.data.get("member").is_none());
    }

    #[test]
    fn what_is_not_a_slash_command_is_set_aside() {
        for kind in [1, 3, 4, 5] {
            let mut value = interaction(json!([]));
            value["type"] = json!(kind);
            // A message component or a ping carries other data; none of them is a command.
            let result = serde_json::from_value::<GatewayInteraction>(value)
                .ok()
                .map(|interaction| normalize(&interaction));
            if let Some(result) = result {
                assert!(result.is_err(), "type {kind}");
            }
        }
        for kind in [2, 3] {
            let mut value = interaction(json!([]));
            value["data"]["type"] = json!(kind);
            assert_eq!(
                normalize(&parse(value)),
                Err(NormalizeError::NotASlashCommand)
            );
        }
    }

    #[test]
    fn a_command_with_no_author_is_malformed() {
        // A command with no data does not even parse, so the gateway never delivers one.
        let mut value = interaction(json!([]));
        value.as_object_mut().unwrap().remove("member");
        assert_eq!(normalize(&parse(value)), Err(NormalizeError::Malformed));
    }

    #[test]
    fn hostile_options_are_errors_not_panics() {
        let huge = "x".repeat(MAX_TEXT_CHARS + 1);
        let many: Vec<Value> = (0..=MAX_OPTIONS)
            .map(|n| json!({ "name": format!("o{n}"), "type": 4, "value": n }))
            .collect();
        let tables = [
            json!([{ "name": "a", "type": 3, "value": huge }]),
            Value::Array(many),
            json!([{ "name": "", "type": 3, "value": "x" }]),
            json!([{ "name": "n".repeat(33), "type": 3, "value": "x" }]),
            json!([{ "name": "a", "type": 3, "value": "x" }, { "name": "a", "type": 3, "value": "y" }]),
            json!([{ "name": "sub", "type": 1, "options": [] }]),
            json!([{ "name": "group", "type": 2, "options": [] }]),
            json!([{ "name": "who", "type": 9, "value": "5" }]),
            json!([{ "name": "file", "type": 11, "value": "5" }]),
        ];
        for options in tables {
            let result = serde_json::from_value::<GatewayInteraction>(interaction(options))
                .ok()
                .map(|interaction| normalize(&interaction));
            if let Some(result) = result {
                assert_eq!(result, Err(NormalizeError::Malformed));
            }
        }
    }

    #[test]
    fn a_name_that_is_empty_or_too_long_is_malformed() {
        for name in [String::new(), "n".repeat(33)] {
            let mut value = interaction(json!([]));
            value["data"]["name"] = json!(name);
            assert_eq!(normalize(&parse(value)), Err(NormalizeError::Malformed));
        }
    }

    #[test]
    fn an_id_that_points_to_the_far_future_is_an_error() {
        let mut value = interaction(json!([]));
        value["id"] = json!(u64::MAX.to_string());
        let result = normalize(&parse(value));
        assert!(result.is_ok() || result == Err(NormalizeError::Malformed));
    }
}
