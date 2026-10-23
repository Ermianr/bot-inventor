//! The limits Discord puts on slash commands (`docs/ARCHITECTURE.md` §7), and the definition and
//! hash of a command.

use graph::{FlowName, Node};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::diagnostic::{Code, Diagnostic};

pub const MAX_NAME_CHARS: usize = 32;
pub const MAX_DESCRIPTION_CHARS: usize = 100;
pub const MAX_OPTIONS: usize = 25;
/// The most characters in the names and descriptions of one command, options included.
pub const MAX_COMMAND_CHARS: usize = 8000;
/// The most `CHAT_INPUT` commands an app may register.
pub const MAX_COMMANDS: usize = 100;

/// A slash command found in a flow.
pub(super) struct Command {
    pub name: String,
    pub definition: Map<String, Value>,
    pub hash: String,
}

/// Checks the command that `node` defines and builds its definition. The settings have already
/// matched the schema, so the fields exist with the right types.
pub(super) fn check_command(
    flow: &FlowName,
    node: &Node,
    out: &mut Vec<Diagnostic>,
) -> Option<Command> {
    let mut found = Found {
        flow,
        node,
        out,
        errors: 0,
    };
    let name = text(&node.settings, "name");
    let description = text(&node.settings, "description");
    found.name(name, "name");
    found.description(description, "description");

    let options: &[Value] = match node.settings.get("options") {
        Some(Value::Array(items)) => items,
        _ => &[],
    };
    if options.len() > MAX_OPTIONS {
        let message = format!(
            "a command has at most {MAX_OPTIONS} options, this one has {}",
            options.len()
        );
        found.push("options", Code::TooManyOptions, message);
    }
    let mut seen: Vec<&str> = Vec::new();
    let mut optional_seen = false;
    let mut definitions = Vec::new();
    let mut sizes = vec![(name, description)];
    for (number, option) in options.iter().enumerate() {
        let Some(map) = option.as_object() else {
            continue;
        };
        let option_name = text(map, "name");
        let option_description = text(map, "description");
        found.name(option_name, &format!("options[{number}].name"));
        found.description(
            option_description,
            &format!("options[{number}].description"),
        );
        if seen.contains(&option_name) {
            found.push(
                &format!("options[{number}].name"),
                Code::DuplicateOption,
                "another option of this command has the same name".to_owned(),
            );
        }
        seen.push(option_name);
        let required = map
            .get("required")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if required && optional_seen {
            found.push(
                &format!("options[{number}].required"),
                Code::OptionOrder,
                "Discord needs the required options before the optional ones".to_owned(),
            );
        }
        optional_seen |= !required;
        definitions.push(json!({
            "type": option_type(text(map, "type")),
            "name": option_name,
            "description": option_description,
            "required": required,
        }));
        sizes.push((option_name, option_description));
    }
    let total = command_size(&sizes);
    if total > MAX_COMMAND_CHARS {
        let message = format!(
            "the names and descriptions add up to {total} characters; Discord allows {MAX_COMMAND_CHARS}"
        );
        found.push("options", Code::CommandTooLarge, message);
    }
    if found.errors > 0 {
        return None;
    }

    let mut definition = Map::new();
    definition.insert("type".to_owned(), json!(1));
    definition.insert("name".to_owned(), json!(name));
    definition.insert("description".to_owned(), json!(description));
    if !definitions.is_empty() {
        definition.insert("options".to_owned(), Value::Array(definitions));
    }
    let hash = definition_hash(&definition);
    Some(Command {
        name: name.to_owned(),
        definition,
        hash,
    })
}

/// The characters Discord counts against the limit of one command.
pub(super) fn command_size(texts: &[(&str, &str)]) -> usize {
    texts
        .iter()
        .map(|(name, description)| name.chars().count() + description.chars().count())
        .sum()
}

/// A command name or option name: 1 to 32 lowercase letters, digits, `-` or `_`.
pub(super) fn is_valid_name(name: &str) -> bool {
    let length = name.chars().count();
    (1..=MAX_NAME_CHARS).contains(&length)
        && name.chars().all(|c| {
            c == '-' || c == '_' || (c.is_alphanumeric() && c.to_lowercase().eq(std::iter::once(c)))
        })
}

fn text<'a>(map: &'a Map<String, Value>, key: &str) -> &'a str {
    map.get(key).and_then(Value::as_str).unwrap_or("")
}

/// The number Discord uses for each kind of option.
fn option_type(kind: &str) -> u8 {
    match kind {
        "integer" => 4,
        "boolean" => 5,
        "user" => 6,
        "channel" => 7,
        "role" => 8,
        "number" => 10,
        _ => 3,
    }
}

struct Found<'a> {
    flow: &'a FlowName,
    node: &'a Node,
    out: &'a mut Vec<Diagnostic>,
    errors: usize,
}

impl Found<'_> {
    fn push(&mut self, path: &str, code: Code, message: String) {
        self.errors += 1;
        self.out.push(Diagnostic {
            flow: Some(self.flow.clone()),
            node: Some(self.node.id.clone()),
            path: Some(path.to_owned()),
            code,
            message,
        });
    }

    fn name(&mut self, name: &str, path: &str) {
        if !is_valid_name(name) {
            self.push(
                path,
                Code::InvalidCommandName,
                format!(
                    "a name has 1 to {MAX_NAME_CHARS} lowercase letters, digits, `-` or `_`; this one has {} characters",
                    name.chars().count()
                ),
            );
        }
    }

    fn description(&mut self, description: &str, path: &str) {
        let length = description.chars().count();
        if !(1..=MAX_DESCRIPTION_CHARS).contains(&length) {
            self.push(
                path,
                Code::InvalidDescription,
                format!("a description has 1 to {MAX_DESCRIPTION_CHARS} characters; this one has {length}"),
            );
        }
    }
}

/// The hash of a definition: SHA-256 of its JSON with the keys in order, in hexadecimal.
fn definition_hash(definition: &Map<String, Value>) -> String {
    let mut canonical = String::new();
    write_canonical(&Value::Object(definition.clone()), &mut canonical);
    let digest = Sha256::digest(canonical.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable();
            out.push('{');
            for (position, key) in keys.into_iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                if let Some(inner) = map.get(key) {
                    write_canonical(inner, out);
                }
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (position, item) in items.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_size_limit_is_inclusive() {
        let at_limit = "x".repeat(MAX_COMMAND_CHARS - 1);
        assert_eq!(command_size(&[(&at_limit, "y")]), MAX_COMMAND_CHARS);
        assert!(command_size(&[(&at_limit, "yy")]) > MAX_COMMAND_CHARS);
    }

    #[test]
    fn names_follow_discords_rules() {
        assert!(is_valid_name("ping"));
        assert!(is_valid_name("a-b_9"));
        assert!(is_valid_name(&"a".repeat(MAX_NAME_CHARS)));
        assert!(!is_valid_name(&"a".repeat(MAX_NAME_CHARS + 1)));
        assert!(!is_valid_name(""));
        assert!(!is_valid_name("Ping"));
        assert!(!is_valid_name("two words"));
        assert!(!is_valid_name("a.b"));
    }
}
