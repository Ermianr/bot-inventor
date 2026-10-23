//! The project and payload types, their versions, migrations and files.
//!
//! This crate depends on nothing else in the repository (`docs/ARCHITECTURE.md` §2).
//!
//! The **project** side: the types of `bot.botproj` and `flows/*.flow.json`, and
//! [`Project::load`] and [`Project::save`]. The **payload** side: the types of what the
//! runner executes ([`Payload`]), its codec (MessagePack with zstd) and the container
//! footer that carries it at the end of an exported bot.

mod codec;
mod container;
mod error;
mod io;
pub mod migrate;
mod model;
mod names;
mod payload;

pub use codec::{MAX_DECOMPRESSED_BYTES, MAX_DEPTH, MAX_PAYLOAD_BYTES, PayloadError, dump_json};
pub use container::{CONTAINER_VERSION, FOOTER_LEN, MAGIC, read_container, write_container};
pub use error::ProjectError;
pub use io::{
    FLOW_SUFFIX, FLOWS_DIR, GITIGNORE_FILE, Loaded, MANIFEST_FILE, MAX_FILE_BYTES, MAX_FLOWS,
};
pub use model::{
    CURRENT_FORMAT_VERSION, Editor, Flow, Line, Manifest, Node, Platform, Port, Project, Variable,
    VariableScope, VariableType,
};
pub use names::{Alias, FlowName, MAX_NAME_LEN, NameError, NodeId, PortName, VariableName};
pub use payload::{
    CURRENT_PAYLOAD_VERSION, CommandDef, EventRoute, Expression, Output, Payload, PayloadFlow,
    PayloadNode, Requirements,
};
