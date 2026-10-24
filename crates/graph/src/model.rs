//! The types of a project: the manifest, the flows and their nodes.
//!
//! The node `type` and the `settings` are opaque here: the catalog that gives them a
//! meaning lives in `runtime`, and the checks on a graph (ports, cycles, references)
//! are made when it is compiled.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Map, Value};

use crate::names::{Alias, FlowName, NodeId, PortName, VariableName};

/// How the TypeScript types describe a JSON value in `settings` and `initial`. `serde_json::Value`
/// holds 64-bit integers, which `specta` refuses to export, and a setting is a plain JSON number
/// to the editor (`i32` stands for `number`, as on `Editor`). It is only a stand-in for `specta(type = ...)`; no value is ever of this type.
#[cfg(feature = "specta")]
#[derive(Serialize, specta::Type)]
#[serde(untagged)]
#[allow(dead_code)]
pub(crate) enum JsonValue {
    Null,
    Bool(bool),
    Number(i32),
    Text(String),
    List(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

/// The version of the project format this crate reads and writes.
pub const CURRENT_FORMAT_VERSION: u32 = 1;

/// A project in memory: the manifest and one [`Flow`] per `flows/<name>.flow.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Project {
    pub manifest: Manifest,
    pub flows: BTreeMap<FlowName, Flow>,
}

/// The content of `bot.botproj`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Manifest {
    pub format_version: u32,
    pub name: String,
    pub platform: Platform,
    /// Settings of the project as a whole; their keys are not fixed yet.
    #[serde(serialize_with = "sorted_map")]
    #[cfg_attr(feature = "specta", specta(type = BTreeMap<String, JsonValue>))]
    pub settings: Map<String, Value>,
    pub variables: Vec<Variable>,
}

impl Manifest {
    /// An empty manifest of the current format version.
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            format_version: CURRENT_FORMAT_VERSION,
            name: name.into(),
            platform: Platform::Discord,
            settings: Map::new(),
            variables: Vec::new(),
        }
    }
}

/// The platform a bot runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum Platform {
    Discord,
}

/// A declared variable (`docs/ARCHITECTURE.md` §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Variable {
    pub name: VariableName,
    #[serde(rename = "type")]
    pub kind: VariableType,
    pub scope: VariableScope,
    #[serde(serialize_with = "sorted_value")]
    #[cfg_attr(feature = "specta", specta(type = JsonValue))]
    pub initial: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum VariableType {
    Integer,
    Decimal,
    Text,
    Boolean,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum VariableScope {
    Run,
    Bot,
    Server,
    Member,
    User,
}

/// The content of one `*.flow.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Flow {
    pub nodes: Vec<Node>,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Node {
    pub id: NodeId,
    pub alias: Alias,
    /// The node type, for example `discord.slash_command`.
    #[serde(rename = "type")]
    pub kind: String,
    pub type_version: u32,
    #[serde(serialize_with = "sorted_map")]
    #[cfg_attr(feature = "specta", specta(type = BTreeMap<String, JsonValue>))]
    pub settings: Map<String, Value>,
    pub editor: Editor,
}

/// Where the editor draws a node. It is not part of the compiled payload.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Editor {
    // `specta` types an `f64` as `number | null` (NaN is written as null); a position is always
    // finite (save refuses the rest), so the editor sees a plain `number`.
    #[cfg_attr(feature = "specta", specta(type = i32))]
    pub x: f64,
    #[cfg_attr(feature = "specta", specta(type = i32))]
    pub y: f64,
}

/// An execution link from an output port of one node to another node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Line {
    pub from: Port,
    pub to: NodeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Port {
    pub node: NodeId,
    pub port: PortName,
}

/// A value whose objects are written with their keys in order. `serde_json` keeps
/// insertion order when any crate in the build turns on `preserve_order`, so a file
/// would otherwise depend on how the value was built.
struct Sorted<'a>(&'a Value);

impl Serialize for Sorted<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        match self.0 {
            Value::Object(map) => serialize_sorted_entries(map, serializer),
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(&Sorted(item))?;
                }
                seq.end()
            }
            other => other.serialize(serializer),
        }
    }
}

fn serialize_sorted_entries<S: Serializer>(
    map: &Map<String, Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut entries: Vec<(&String, &Value)> = map.iter().collect();
    entries.sort_unstable_by(|a, b| a.0.cmp(b.0));
    let mut out = serializer.serialize_map(Some(entries.len()))?;
    for (key, value) in entries {
        out.serialize_entry(key, &Sorted(value))?;
    }
    out.end()
}

pub(crate) fn sorted_map<S: Serializer>(
    map: &Map<String, Value>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serialize_sorted_entries(map, serializer)
}

pub(crate) fn sorted_value<S: Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    Sorted(value).serialize(serializer)
}
