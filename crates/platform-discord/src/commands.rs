//! Slash commands: what the payload defines against what Discord has registered, and the calls
//! that bring the second to the first (`docs/ARCHITECTURE.md` §7).
//!
//! Discord allows 200 command creations a day per server, so a start sends only the difference.
//! The comparison reads the commands as Discord returns them and checks every field the payload
//! defines; it does not rely on a hash stored anywhere, so a command edited by hand in the
//! Developer Portal is put back.

use serde_json::{Map, Value};
use twilight_http::Client;
use twilight_model::application::command::CommandOption;
use twilight_model::id::Id;
use twilight_model::id::marker::{ApplicationMarker, CommandMarker, GuildMarker};

use crate::AdapterError;

/// The command types the adapter manages: slash, user and message commands. Others (an
/// Activity's entry point) belong to something else and are never touched.
const MANAGED_KINDS: [u64; 3] = [1, 2, 3];

/// Keys where Discord drops a default from the answer: a missing one means `false` or empty, so
/// a command that still has a value for one the payload does not define is different.
const DEFAULTED_KEYS: [&str; 4] = ["options", "choices", "required", "nsfw"];

/// A command the payload defines.
#[derive(Debug, Clone, PartialEq)]
pub struct Wanted {
    pub name: String,
    /// The definition as the platform expects it (`CommandDef::definition`).
    pub definition: Map<String, Value>,
}

/// A command Discord has registered.
#[derive(Debug, Clone, PartialEq)]
pub struct Registered {
    pub id: String,
    /// The command as Discord returned it, as data.
    pub definition: Value,
}

/// The calls a start must make.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Plan {
    pub create: Vec<Wanted>,
    /// The id of the registered command and the definition that replaces it.
    pub update: Vec<(String, Wanted)>,
    /// The ids of the registered commands that the payload no longer defines.
    pub delete: Vec<String>,
}

impl Plan {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.create.is_empty() && self.update.is_empty() && self.delete.is_empty()
    }
}

/// How many calls a start made.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SyncReport {
    pub created: usize,
    pub updated: usize,
    pub deleted: usize,
}

fn kind_of(definition: &Value) -> u64 {
    definition.get("type").and_then(Value::as_u64).unwrap_or(1)
}

fn name_of(definition: &Value) -> Option<&str> {
    definition.get("name").and_then(Value::as_str)
}

/// A value that Discord leaves out when it is the default.
fn is_default(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => true,
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.is_empty(),
        _ => false,
    }
}

/// Whether `registered` has everything `wanted` defines, with the defaults that Discord leaves
/// out counted as present. Fields Discord adds on its own (`id`, `version`, `contexts`) are not
/// looked at.
fn satisfies(registered: Option<&Value>, wanted: &Value) -> bool {
    match (registered, wanted) {
        (None | Some(Value::Null), wanted) => is_default(wanted),
        (Some(registered), Value::Object(wanted)) => {
            registered.as_object().is_some_and(|registered| {
                wanted
                    .iter()
                    .all(|(key, value)| satisfies(registered.get(key), value))
                    && DEFAULTED_KEYS.iter().all(|key| {
                        wanted.contains_key(*key) || registered.get(*key).is_none_or(is_default)
                    })
            })
        }
        (Some(registered), Value::Array(wanted)) => {
            registered.as_array().is_some_and(|registered| {
                registered.len() == wanted.len()
                    && registered
                        .iter()
                        .zip(wanted)
                        .all(|(registered, wanted)| satisfies(Some(registered), wanted))
            })
        }
        (Some(registered), wanted) => registered == wanted,
    }
}

/// What a start must do so that Discord has exactly the `wanted` commands. Commands are the
/// same when their type and name are.
#[must_use]
pub fn plan(registered: &[Registered], wanted: &[Wanted]) -> Plan {
    let mut plan = Plan::default();
    let mut matched = vec![false; registered.len()];
    for want in wanted {
        let definition = Value::Object(want.definition.clone());
        let found = registered.iter().enumerate().find(|(at, command)| {
            !matched[*at]
                && kind_of(&command.definition) == kind_of(&definition)
                && name_of(&command.definition) == Some(want.name.as_str())
        });
        match found {
            Some((at, command)) => {
                matched[at] = true;
                if !satisfies(Some(&command.definition), &definition) {
                    plan.update.push((command.id.clone(), want.clone()));
                }
            }
            None => plan.create.push(want.clone()),
        }
    }
    for (at, command) in registered.iter().enumerate() {
        if !matched[at] && MANAGED_KINDS.contains(&kind_of(&command.definition)) {
            plan.delete.push(command.id.clone());
        }
    }
    plan
}

/// Where the commands are registered: for the whole app, or only in one server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Global,
    Guild(Id<GuildMarker>),
}

/// A command ready to be sent: the typed parts of a chat input definition.
struct Parts<'a> {
    name: &'a str,
    description: &'a str,
    options: Vec<CommandOption>,
}

fn parts(want: &Wanted) -> Result<Parts<'_>, AdapterError> {
    let unsupported = || AdapterError::UnsupportedCommand(want.name.clone());
    if want
        .definition
        .get("type")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        != 1
    {
        return Err(unsupported());
    }
    let description = want
        .definition
        .get("description")
        .and_then(Value::as_str)
        .ok_or_else(unsupported)?;
    let options = match want.definition.get("options") {
        None => Vec::new(),
        Some(options) => serde_json::from_value(options.clone()).map_err(|_| unsupported())?,
    };
    Ok(Parts {
        name: &want.name,
        description,
        options,
    })
}

fn command_id(id: &str) -> Result<Id<CommandMarker>, AdapterError> {
    id.parse::<u64>()
        .ok()
        .and_then(Id::new_checked)
        .ok_or(AdapterError::Api(0))
}

/// Brings the commands Discord has registered in `target` to `wanted`, with the fewest calls:
/// none when they already match.
///
/// # Errors
///
/// [`AdapterError`] when a command cannot be registered or a request fails.
pub async fn sync(
    client: &Client,
    application: Id<ApplicationMarker>,
    target: Target,
    wanted: &[Wanted],
) -> Result<SyncReport, AdapterError> {
    // Everything is checked before the first call, so a bad command changes nothing.
    for want in wanted {
        parts(want)?;
    }
    let interaction = client.interaction(application);
    let commands = match target {
        Target::Global => interaction.global_commands().await,
        Target::Guild(guild) => interaction.guild_commands(guild).await,
    }
    .map_err(|e| AdapterError::from_http(&e))?
    .models()
    .await
    .map_err(|_| AdapterError::Network)?;
    let registered: Vec<Registered> = commands
        .iter()
        .filter_map(|command| {
            Some(Registered {
                id: command.id?.get().to_string(),
                definition: serde_json::to_value(command).ok()?,
            })
        })
        .collect();
    let plan = plan(&registered, wanted);

    let mut report = SyncReport::default();
    for id in &plan.delete {
        let id = command_id(id)?;
        match target {
            Target::Global => interaction.delete_global_command(id).await,
            Target::Guild(guild) => interaction.delete_guild_command(guild, id).await,
        }
        .map_err(|e| AdapterError::from_http(&e))?;
        report.deleted += 1;
    }
    for (id, want) in &plan.update {
        let (id, parts) = (command_id(id)?, parts(want)?);
        match target {
            Target::Global => {
                interaction
                    .update_global_command(id)
                    .name(parts.name)
                    .description(parts.description)
                    .command_options(&parts.options)
                    .await
            }
            Target::Guild(guild) => {
                interaction
                    .update_guild_command(guild, id)
                    .name(parts.name)
                    .description(parts.description)
                    .command_options(&parts.options)
                    .await
            }
        }
        .map_err(|e| AdapterError::from_http(&e))?;
        report.updated += 1;
    }
    for want in &plan.create {
        let parts = parts(want)?;
        match target {
            Target::Global => {
                interaction
                    .create_global_command()
                    .chat_input(parts.name, parts.description)
                    .command_options(&parts.options)
                    .await
            }
            Target::Guild(guild) => {
                interaction
                    .create_guild_command(guild)
                    .chat_input(parts.name, parts.description)
                    .command_options(&parts.options)
                    .await
            }
        }
        .map_err(|e| AdapterError::from_http(&e))?;
        report.created += 1;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn wanted(name: &str, options: &Value) -> Wanted {
        let mut definition = Map::new();
        definition.insert("type".to_owned(), json!(1));
        definition.insert("name".to_owned(), json!(name));
        definition.insert(
            "description".to_owned(),
            json!(format!("The {name} command")),
        );
        if options
            .as_array()
            .is_some_and(|options| !options.is_empty())
        {
            definition.insert("options".to_owned(), options.clone());
        }
        Wanted {
            name: name.to_owned(),
            definition,
        }
    }

    /// The command as Discord returns it: the definition plus what Discord adds.
    fn registered(id: &str, want: &Wanted) -> Registered {
        let mut definition = want.definition.clone();
        definition.insert("id".to_owned(), json!(id));
        definition.insert("application_id".to_owned(), json!("1"));
        definition.insert("version".to_owned(), json!("9"));
        definition.insert("default_member_permissions".to_owned(), Value::Null);
        definition.insert("nsfw".to_owned(), json!(false));
        definition.insert("contexts".to_owned(), json!([0, 1, 2]));
        definition.insert("integration_types".to_owned(), json!([0, 1]));
        definition.insert("name_localizations".to_owned(), Value::Null);
        definition.insert("description_localizations".to_owned(), Value::Null);
        definition.entry("options").or_insert_with(|| json!([]));
        Registered {
            id: id.to_owned(),
            definition: Value::Object(definition),
        }
    }

    fn option(name: &str, required: bool) -> Value {
        json!({ "type": 3, "name": name, "description": "An option", "required": required })
    }

    #[test]
    fn a_second_start_with_nothing_changed_sends_nothing() {
        let ping = wanted("ping", &json!([]));
        let kick = wanted("kick", &json!([option("reason", false)]));
        let live = [registered("10", &ping), registered("11", &kick)];
        let plan = plan(&live, &[ping, kick]);
        assert!(plan.is_empty(), "{plan:?}");
    }

    #[test]
    fn the_order_of_the_commands_does_not_matter() {
        let ping = wanted("ping", &json!([]));
        let kick = wanted("kick", &json!([]));
        let live = [registered("11", &kick), registered("10", &ping)];
        assert!(plan(&live, &[ping, kick]).is_empty());
    }

    #[test]
    fn a_new_command_is_created() {
        let ping = wanted("ping", &json!([]));
        let kick = wanted("kick", &json!([]));
        let plan = plan(&[registered("10", &ping)], &[ping, kick.clone()]);
        assert_eq!(plan.create, [kick]);
        assert!(plan.update.is_empty() && plan.delete.is_empty());
    }

    #[test]
    fn only_the_command_that_changed_is_updated() {
        let ping = wanted("ping", &json!([]));
        let kick = wanted("kick", &json!([option("reason", false)]));
        let live = [registered("10", &ping), registered("11", &kick)];
        let changed = wanted("kick", &json!([option("reason", true)]));
        let plan = plan(&live, &[ping, changed.clone()]);
        assert_eq!(plan.update, [("11".to_owned(), changed)]);
        assert!(plan.create.is_empty() && plan.delete.is_empty());
    }

    #[test]
    fn each_kind_of_edit_is_noticed() {
        let base = wanted("kick", &json!([option("reason", false)]));
        let live = [registered("11", &base)];
        let edits = [
            // The description.
            {
                let mut want = base.clone();
                want.definition
                    .insert("description".to_owned(), json!("Another"));
                want
            },
            // An option added, removed, renamed or made required.
            wanted(
                "kick",
                &json!([option("reason", false), option("days", false)]),
            ),
            wanted("kick", &json!([])),
            wanted("kick", &json!([option("why", false)])),
            wanted("kick", &json!([option("reason", true)])),
        ];
        for edit in edits {
            let plan = plan(&live, std::slice::from_ref(&edit));
            assert_eq!(plan.update.len(), 1, "{edit:?}");
        }
    }

    #[test]
    fn an_edit_made_in_the_portal_is_put_back() {
        let kick = wanted("kick", &json!([]));
        let mut live = registered("11", &kick);
        live.definition["description"] = json!("Changed by hand");
        assert_eq!(
            plan(std::slice::from_ref(&live), std::slice::from_ref(&kick))
                .update
                .len(),
            1
        );

        // An option that the payload does not define, or a flag it does not set.
        let mut live = registered("11", &kick);
        live.definition["options"] = json!([option("extra", false)]);
        assert_eq!(plan(&[live], std::slice::from_ref(&kick)).update.len(), 1);
        let mut live = registered("11", &kick);
        live.definition["nsfw"] = json!(true);
        assert_eq!(plan(&[live], &[kick]).update.len(), 1);
    }

    #[test]
    fn what_discord_adds_on_its_own_is_not_a_difference() {
        let kick = wanted("kick", &json!([option("reason", false)]));
        let mut live = registered("11", &kick);
        live.definition["version"] = json!("99");
        live.definition["contexts"] = json!([0]);
        live.definition["options"][0]["required"] = Value::Null;
        live.definition["options"][0]["name_localizations"] = Value::Null;
        assert!(plan(&[live], &[kick]).is_empty());
    }

    #[test]
    fn a_command_that_is_gone_is_deleted() {
        let ping = wanted("ping", &json!([]));
        let kick = wanted("kick", &json!([]));
        let live = [registered("10", &ping), registered("11", &kick)];
        let plan = plan(&live, &[ping]);
        assert_eq!(plan.delete, ["11"]);
        assert!(plan.create.is_empty() && plan.update.is_empty());
    }

    #[test]
    fn a_command_of_a_kind_the_adapter_does_not_manage_is_left_alone() {
        let ping = wanted("ping", &json!([]));
        let entry_point = Registered {
            id: "12".to_owned(),
            definition: json!({ "type": 4, "name": "launch", "description": "" }),
        };
        let live = [registered("10", &ping), entry_point];
        assert!(plan(&live, &[ping]).is_empty());
    }

    #[test]
    fn nothing_registered_creates_everything_and_nothing_wanted_deletes_everything() {
        let ping = wanted("ping", &json!([]));
        let created = plan(&[], std::slice::from_ref(&ping)).create;
        assert_eq!(created, std::slice::from_ref(&ping));
        assert_eq!(plan(&[registered("10", &ping)], &[]).delete, ["10"]);
        assert!(plan(&[], &[]).is_empty());
    }

    #[test]
    fn a_slash_command_and_a_user_command_with_one_name_are_different_commands() {
        let ping = wanted("ping", &json!([]));
        let mut user_command = registered("10", &ping);
        user_command.definition["type"] = json!(2);
        let plan = plan(&[user_command], std::slice::from_ref(&ping));
        assert_eq!(plan.create, [ping]);
        assert_eq!(plan.delete, ["10"]);
    }

    #[test]
    fn only_a_chat_input_definition_can_be_sent() {
        let mut want = wanted("ping", &json!([]));
        assert!(parts(&want).is_ok());
        want.definition.insert("type".to_owned(), json!(2));
        assert_eq!(
            parts(&want).err(),
            Some(AdapterError::UnsupportedCommand("ping".to_owned()))
        );
        let mut broken = wanted("ping", &json!([]));
        broken
            .definition
            .insert("options".to_owned(), json!("not a list"));
        assert!(parts(&broken).is_err());
        broken.definition.remove("description");
        assert!(parts(&broken).is_err());
    }

    // --- the requests, against a fake Discord ---------------------------------------------

    use crate::testing::FakeDiscord;

    fn live(command: &Wanted, id: &str) -> Value {
        let mut value = registered(id, command).definition;
        value["application_id"] = json!("1");
        value
    }

    #[tokio::test]
    async fn a_first_start_creates_the_commands_and_a_second_start_sends_nothing() {
        let fake = FakeDiscord::start().await;
        let client = fake.client();
        let ping = wanted("ping", &json!([]));
        let kick = wanted("kick", &json!([option("reason", true)]));

        // First start: Discord has nothing.
        fake.answer(200, &json!([]));
        fake.answer(200, &live(&ping, "10"));
        fake.answer(200, &live(&kick, "11"));
        let report = sync(
            &client,
            Id::new(1),
            Target::Global,
            &[ping.clone(), kick.clone()],
        )
        .await
        .unwrap();
        assert_eq!(
            report,
            SyncReport {
                created: 2,
                updated: 0,
                deleted: 0
            }
        );
        let seen = fake.seen();
        assert_eq!(seen.len(), 3);
        assert_eq!(seen[0].method, "GET");
        assert!(
            seen[0].path.ends_with("/applications/1/commands"),
            "{}",
            seen[0].path
        );
        assert_eq!(seen[1].method, "POST");
        assert_eq!(seen[1].body["name"], "ping");
        assert_eq!(seen[1].body["type"], 1);
        assert_eq!(seen[2].body["options"][0]["name"], "reason");
        assert_eq!(seen[2].body["options"][0]["required"], true);

        // Second start: Discord has them. The only request is the one that reads them.
        fake.answer(200, &json!([live(&ping, "10"), live(&kick, "11")]));
        let report = sync(&client, Id::new(1), Target::Global, &[ping, kick])
            .await
            .unwrap();
        assert_eq!(report, SyncReport::default());
        assert_eq!(fake.seen().len(), 4);
        assert_eq!(fake.seen()[3].method, "GET");
    }

    #[tokio::test]
    async fn a_changed_command_is_patched_and_a_removed_one_is_deleted() {
        let fake = FakeDiscord::start().await;
        let client = fake.client();
        let old_kick = wanted("kick", &json!([option("reason", false)]));
        let ping = wanted("ping", &json!([]));
        let new_kick = wanted("kick", &json!([]));
        fake.answer(200, &json!([live(&old_kick, "11"), live(&ping, "10")]));
        fake.answer(204, &Value::Null);
        fake.answer(200, &live(&new_kick, "11"));
        let report = sync(&client, Id::new(1), Target::Global, &[new_kick])
            .await
            .unwrap();
        assert_eq!(
            report,
            SyncReport {
                created: 0,
                updated: 1,
                deleted: 1
            }
        );

        let seen = fake.seen();
        assert_eq!(
            (
                seen[1].method.as_str(),
                seen[1].path.ends_with("/commands/10")
            ),
            ("DELETE", true)
        );
        assert_eq!(
            (
                seen[2].method.as_str(),
                seen[2].path.ends_with("/commands/11")
            ),
            ("PATCH", true)
        );
        // The option that is gone is cleared, not left as it was.
        assert_eq!(seen[2].body["options"], json!([]));
    }

    #[tokio::test]
    async fn with_a_dev_guild_the_commands_go_only_to_that_server() {
        let fake = FakeDiscord::start().await;
        let client = fake.client();
        let ping = wanted("ping", &json!([]));
        fake.answer(200, &json!([]));
        fake.answer(200, &live(&ping, "10"));
        let guild = Id::new(5555);
        sync(&client, Id::new(1), Target::Guild(guild), &[ping])
            .await
            .unwrap();
        for seen in fake.seen() {
            assert!(seen.path.contains("/guilds/5555/commands"), "{}", seen.path);
        }
    }

    #[tokio::test]
    async fn a_command_that_cannot_be_sent_changes_nothing() {
        let fake = FakeDiscord::start().await;
        let client = fake.client();
        let ping = wanted("ping", &json!([]));
        let mut user_command = wanted("who", &json!([]));
        user_command.definition.insert("type".to_owned(), json!(2));
        let result = sync(&client, Id::new(1), Target::Global, &[ping, user_command]).await;
        assert_eq!(
            result,
            Err(AdapterError::UnsupportedCommand("who".to_owned()))
        );
        assert!(fake.seen().is_empty());
    }

    #[tokio::test]
    async fn a_rejected_token_and_a_failing_server_are_told_apart_without_their_text() {
        for (status, expected) in [
            (401, AdapterError::InvalidToken),
            (403, AdapterError::Api(403)),
            (500, AdapterError::Api(500)),
        ] {
            let fake = FakeDiscord::start().await;
            fake.answer(
                status,
                &json!({ "message": "401: Unauthorized", "code": 0 }),
            );
            let result = sync(&fake.client(), Id::new(1), Target::Global, &[]).await;
            assert_eq!(result, Err(expected), "status {status}");
        }
    }
}
