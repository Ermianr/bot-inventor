//! The node catalog: the schema of every node type (`docs/ARCHITECTURE.md` §5.2).
//!
//! A schema is data: the fields a node has, with their kinds and limits, its output ports, the
//! values it publishes to later nodes and what it needs from the platform. Compile checks a
//! project against these schemas; the property panel of the editor is drawn from them. The
//! executor of a node lives beside its schema and arrives with the run loop.

mod builtin;

use std::collections::BTreeMap;

pub use builtin::builtin_specs;

/// The port a node that can fail leaves through when it does.
pub const ERROR_PORT: &str = "error";

/// The schema of one version of one node type.
#[derive(Debug)]
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
pub struct FieldSpec {
    pub name: &'static str,
    pub kind: FieldKind,
    pub required: bool,
}

/// The kind of a setting and its limits.
#[derive(Debug)]
pub enum FieldKind {
    /// Text of `min` to `max` characters. With `template`, it is plain text with
    /// `{{ expression }}` segments.
    Text {
        min: usize,
        max: usize,
        template: bool,
    },
    /// The source of one expression, such as the condition of a branch.
    Expression,
    /// A whole number from `min` to `max`.
    Integer {
        min: i64,
        max: i64,
    },
    Boolean,
    /// One of a closed list of words.
    Choice(&'static [&'static str]),
    /// A path inside the `assets/` folder of the project.
    Asset,
    /// A list of at most `max` objects with the fields of `item`.
    List {
        max: usize,
        item: &'static [FieldSpec],
    },
}

#[derive(Debug)]
pub struct PortSpec {
    pub name: &'static str,
}

#[derive(Debug)]
pub struct OutputSpec {
    pub name: &'static str,
}

/// What a node needs from the platform; compile joins these over the nodes in use.
#[derive(Debug, Clone, Copy)]
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
pub struct TriggerSpec {
    /// The kind of event that starts the flow, as the event table of the payload names it.
    pub event: &'static str,
    /// Whether the node defines a slash command to register.
    pub command: bool,
    /// The fields of `event` that always exist, as dotted paths (`user.id`).
    pub fields: &'static [&'static str],
    /// The setting that lists the options of a command; each option's `name` becomes a field
    /// `event.options.<name>`.
    pub options_field: Option<&'static str>,
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
