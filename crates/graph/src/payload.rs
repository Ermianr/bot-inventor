//! The types of the payload: what the runner executes (`docs/ARCHITECTURE.md` §3.2).
//!
//! A payload carries only logic, with no positions, comments or groups. Lines are index
//! adjacency, so the runner never looks a name up while a flow runs. The node `type` and
//! the `settings` are opaque here, as in the project; `runtime` gives them a meaning.
//! Building a payload from a project is the compile step of `runtime`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::codec::PayloadError;
use crate::model::{Variable, sorted_map};
use crate::names::{Alias, FlowName, NodeId, PortName};

/// The version of the payload format this crate reads and writes.
pub const CURRENT_PAYLOAD_VERSION: u32 = 1;

/// A compiled bot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Payload {
    pub version: u32,
    /// The version of the app that compiled it.
    pub app_version: String,
    pub flows: Vec<PayloadFlow>,
    /// Which flows start with each kind of event.
    pub events: Vec<EventRoute>,
    /// The slash commands to register.
    pub commands: Vec<CommandDef>,
    pub variables: Vec<Variable>,
    pub requirements: Requirements,
}

impl Payload {
    /// An empty payload of the current version.
    #[must_use]
    pub fn new(app_version: impl Into<String>) -> Self {
        Self {
            version: CURRENT_PAYLOAD_VERSION,
            app_version: app_version.into(),
            flows: Vec::new(),
            events: Vec::new(),
            commands: Vec::new(),
            variables: Vec::new(),
            requirements: Requirements::default(),
        }
    }

    /// Checks that every index points inside its list. Decoding and encoding both run
    /// it, so the runner can follow an index without checking it again.
    ///
    /// # Errors
    ///
    /// [`PayloadError::Inconsistent`] names the first index that points nowhere.
    pub fn check(&self) -> Result<(), PayloadError> {
        for flow in &self.flows {
            let nodes = flow.nodes.len();
            if usize::try_from(flow.trigger).map_or(true, |trigger| trigger >= nodes) {
                return Err(inconsistent(format!(
                    "flow `{}`: the trigger is node {}, but the flow has {nodes} nodes",
                    flow.name, flow.trigger
                )));
            }
            for node in &flow.nodes {
                for output in &node.next {
                    for target in &output.to {
                        if usize::try_from(*target).map_or(true, |target| target >= nodes) {
                            return Err(inconsistent(format!(
                                "flow `{}`, node `{}`, port `{}`: the line goes to node \
                                 {target}, but the flow has {nodes} nodes",
                                flow.name, node.id, output.port
                            )));
                        }
                    }
                }
            }
        }
        let flows = self.flows.len();
        for route in &self.events {
            for flow in &route.flows {
                check_flow_index("event", &route.event, *flow, flows)?;
            }
        }
        for command in &self.commands {
            check_flow_index("command", &command.name, command.flow, flows)?;
        }
        Ok(())
    }
}

fn check_flow_index(what: &str, name: &str, flow: u32, flows: usize) -> Result<(), PayloadError> {
    if usize::try_from(flow).map_or(true, |flow| flow >= flows) {
        return Err(inconsistent(format!(
            "{what} `{name}` points to flow {flow}, but the payload has {flows} flows"
        )));
    }
    Ok(())
}

fn inconsistent(message: String) -> PayloadError {
    PayloadError::Inconsistent(message)
}

/// One flow: its nodes in an array and the index of its trigger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayloadFlow {
    pub name: FlowName,
    /// The index in `nodes` of the node that starts the flow.
    pub trigger: u32,
    pub nodes: Vec<PayloadNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayloadNode {
    pub id: NodeId,
    pub alias: Alias,
    /// The node type, for example `discord.reply`.
    #[serde(rename = "type")]
    pub kind: String,
    pub type_version: u32,
    #[serde(serialize_with = "sorted_map")]
    pub settings: Map<String, Value>,
    /// The expressions and templates of the settings, as text. The runner parses them
    /// once when it starts; the syntax tree is not stored.
    pub expressions: Vec<Expression>,
    /// The lines that leave the node, by output port.
    pub next: Vec<Output>,
}

/// The source text of one expression and where it is in the settings of its node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expression {
    /// The field path inside `settings`, for example `content`.
    pub path: String,
    pub source: String,
}

/// The nodes that an output port leads to, as indexes in the nodes of the same flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Output {
    pub port: PortName,
    pub to: Vec<u32>,
}

/// The flows that start with one kind of event, as indexes in `Payload::flows`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventRoute {
    /// The kind of event, for example `member_joined`.
    pub event: String,
    pub flows: Vec<u32>,
}

/// A slash command to register with the platform.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandDef {
    pub name: String,
    /// The flow that handles it, as an index in `Payload::flows`.
    pub flow: u32,
    /// A hash of the definition, so a start can send only the commands that changed.
    pub hash: String,
    /// The definition as the platform expects it.
    #[serde(serialize_with = "sorted_map")]
    pub definition: Map<String, Value>,
}

/// What the nodes need from the platform, computed when the bot is compiled.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirements {
    /// The gateway intents to enable.
    pub intents: Vec<String>,
    /// The cache resources to keep.
    pub cache: Vec<String>,
    /// The files of `assets/` that the nodes reference.
    pub assets: Vec<String>,
}
