//! The node catalog: the schema of every node type (`docs/ARCHITECTURE.md` §5.2).
//!
//! A schema is data: the fields a node has, with their kinds and limits, its output ports, the
//! values it publishes to later nodes and what it needs from the platform. Compile checks a
//! project against these schemas; the property panel of the editor is drawn from them. The
//! executor of a node lives beside its schema, in `crate::nodes`.

use std::collections::BTreeMap;

pub use crate::nodes::builtin_specs;

/// The port a node that can fail leaves through when it does.
pub const ERROR_PORT: &str = "error";

/// The schema of one version of one node type.
#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct NodeSpec {
    /// The type id, for example `discord.reply`.
    pub type_id: &'static str,
    /// The `type_version` this schema describes.
    pub version: u32,
    pub fields: &'static [FieldSpec],
    /// The output ports, in the order the editor shows them.
    pub ports: &'static [PortSpec],
    /// The named values that later nodes read as `steps.<alias>.<output>`.
    pub outputs: &'static [OutputSpec],
    pub requires: NodeRequires,
    /// Set on a trigger, which has no input and starts a flow.
    pub trigger: Option<TriggerSpec>,
}

impl NodeSpec {
    #[must_use]
    pub fn has_port(&self, name: &str) -> bool {
        self.ports.iter().any(|port| port.name == name)
    }

    #[must_use]
    pub fn has_output(&self, name: &str) -> bool {
        self.outputs.iter().any(|output| output.name == name)
    }
}

/// One setting of a node.
#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct FieldSpec {
    pub name: &'static str,
    pub kind: FieldKind,
    pub required: bool,
}

/// The kind of a setting and its limits.
#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
#[cfg_attr(feature = "specta", serde(tag = "type", content = "value"))]
pub enum FieldKind {
    /// Text of `min` to `max` characters. With `template`, it is plain text with
    /// `{{ expression }}` segments.
    Text {
        #[cfg_attr(feature = "specta", specta(type = u32))]
        min: usize,
        #[cfg_attr(feature = "specta", specta(type = u32))]
        max: usize,
        template: bool,
    },
    /// The source of one expression, such as the condition of a branch.
    Expression,
    /// A whole number from `min` to `max`.
    Integer {
        #[cfg_attr(feature = "specta", specta(type = i32))]
        min: i64,
        #[cfg_attr(feature = "specta", specta(type = i32))]
        max: i64,
    },
    Boolean,
    /// One of a closed list of words.
    Choice(&'static [&'static str]),
    /// A path inside the `assets/` folder of the project.
    Asset,
    /// A list of at most `max` objects with the fields of `item`.
    List {
        #[cfg_attr(feature = "specta", specta(type = u32))]
        max: usize,
        item: &'static [FieldSpec],
    },
}

#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct PortSpec {
    pub name: &'static str,
}

#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct OutputSpec {
    pub name: &'static str,
    /// What the value is, so the condition builder offers the right operators.
    pub kind: ValueKind,
}

/// What a named value is, as far as the editor needs to know. Expressions are not type checked
/// (`docs/ARCHITECTURE.md` §6); this only decides which choices the condition builder offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub enum ValueKind {
    Text,
    Integer,
    Decimal,
    Boolean,
    /// A list of text, such as the roles of a member.
    List,
    /// The type depends on something the schema does not know, such as a variable.
    Any,
}

/// A field of the event that a trigger always provides.
#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct EventField {
    /// A dotted path below `event`, such as `user.id`.
    pub path: &'static str,
    pub kind: ValueKind,
}

/// What a node needs from the platform; compile joins these over the nodes in use.
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct NodeRequires {
    /// Gateway intents, such as `guilds`.
    pub intents: &'static [&'static str],
    /// Cache resources, such as `members`.
    pub cache: &'static [&'static str],
}

impl NodeRequires {
    pub const NOTHING: Self = Self {
        intents: &[],
        cache: &[],
    };
}

/// What makes a node a trigger and what the event it starts offers.
#[derive(Debug)]
#[cfg_attr(feature = "specta", derive(serde::Serialize, specta::Type))]
pub struct TriggerSpec {
    /// The kind of event that starts the flow, as the event table of the payload names it.
    pub event: &'static str,
    /// Whether the node defines a slash command to register.
    pub command: bool,
    /// The fields of `event` that always exist.
    pub fields: &'static [EventField],
    /// The setting that lists the options of a command; each option's `name` becomes a field
    /// `event.options.<name>`.
    pub options_field: Option<&'static str>,
}

/// A field of the event of one flow, as the condition builder and compile see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventName {
    /// The path below `event`: `["user", "id"]`, or `["options", "reason"]`.
    pub segments: Vec<String>,
    pub kind: ValueKind,
    /// The field may be missing: an option the command does not require.
    pub optional: bool,
    /// Names may continue below the field.
    pub open: bool,
}

impl TriggerSpec {
    /// The fields of `event` for a trigger with these settings: the fixed ones, then one
    /// `options.<name>` for each option the settings declare. An option that is not well formed
    /// is left out; the settings check reports it.
    #[must_use]
    pub fn event_names(
        &self,
        settings: &serde_json::Map<String, serde_json::Value>,
    ) -> Vec<EventName> {
        let mut names: Vec<EventName> = self
            .fields
            .iter()
            .map(|field| EventName {
                segments: field.path.split('.').map(str::to_owned).collect(),
                kind: field.kind,
                optional: false,
                open: false,
            })
            .collect();
        let items = self
            .options_field
            .and_then(|field| settings.get(field))
            .and_then(serde_json::Value::as_array);
        for item in items.into_iter().flatten() {
            let Some(name) = item.get("name").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let kind = match item.get("type").and_then(serde_json::Value::as_str) {
                Some("integer") => ValueKind::Integer,
                Some("number") => ValueKind::Decimal,
                Some("boolean") => ValueKind::Boolean,
                Some(_) | None => ValueKind::Text,
            };
            let required = item
                .get("required")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            names.push(EventName {
                segments: vec!["options".to_owned(), name.to_owned()],
                kind,
                optional: !required,
                open: true,
            });
        }
        names
    }
}

/// Why a type and version have no schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupError {
    UnknownType,
    /// The type exists, but not this version of it.
    UnknownVersion,
}

/// Two schemas with the same type and version.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the catalog has two schemas for `{type_id}` version {version}")]
pub struct DuplicateSpec {
    pub type_id: &'static str,
    pub version: u32,
}

/// Every schema, keyed by type and version.
#[derive(Debug)]
pub struct Registry {
    specs: BTreeMap<(&'static str, u32), &'static NodeSpec>,
}

impl Registry {
    /// # Errors
    ///
    /// [`DuplicateSpec`] when two schemas share a type and a version.
    pub fn new(specs: &[&'static NodeSpec]) -> Result<Self, DuplicateSpec> {
        let mut map = BTreeMap::new();
        for spec in specs {
            if map.insert((spec.type_id, spec.version), *spec).is_some() {
                return Err(DuplicateSpec {
                    type_id: spec.type_id,
                    version: spec.version,
                });
            }
        }
        Ok(Self { specs: map })
    }

    /// The registry of the nodes the app ships.
    #[must_use]
    pub fn builtin() -> Self {
        Self::new(builtin_specs()).expect("the built-in schemas have distinct keys")
    }

    /// # Errors
    ///
    /// [`LookupError`] says whether the type or only the version is unknown.
    pub fn get(&self, type_id: &str, version: u32) -> Result<&'static NodeSpec, LookupError> {
        if let Some(spec) = self
            .specs
            .iter()
            .find(|((id, v), _)| *id == type_id && *v == version)
            .map(|(_, spec)| *spec)
        {
            return Ok(spec);
        }
        if self.specs.keys().any(|(id, _)| *id == type_id) {
            Err(LookupError::UnknownVersion)
        } else {
            Err(LookupError::UnknownType)
        }
    }

    /// Every schema, sorted by type and version.
    pub fn specs(&self) -> impl Iterator<Item = &'static NodeSpec> + '_ {
        self.specs.values().copied()
    }
}
