//! The project and payload types, their versions, migrations and files.
//!
//! This crate depends on nothing else in the repository (`docs/ARCHITECTURE.md` §2).
//!
//! For now it holds the **project** side: the types of `bot.botproj` and
//! `flows/*.flow.json`, and [`Project::load`] and [`Project::save`]. The payload comes
//! with its own codec.

mod error;
mod io;
pub mod migrate;
mod model;
mod names;

pub use error::ProjectError;
pub use io::{
    FLOW_SUFFIX, FLOWS_DIR, GITIGNORE_FILE, Loaded, MANIFEST_FILE, MAX_FILE_BYTES, MAX_FLOWS,
};
pub use model::{
    CURRENT_FORMAT_VERSION, Editor, Flow, Line, Manifest, Node, Platform, Port, Project, Variable,
    VariableScope, VariableType,
};
pub use names::{Alias, FlowName, MAX_NAME_LEN, NameError, NodeId, PortName, VariableName};
