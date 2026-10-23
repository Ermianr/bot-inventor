//! Helpers shared by the integration tests.
#![allow(dead_code, clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use graph::{CommandDef, EventRoute, Output, Payload, PayloadFlow, PayloadNode, Requirements};
use serde_json::{Map, Value, json};

pub fn samples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/samples")
}

/// Every file under `dir` by relative path, with its content. Folders are not listed.
pub fn read_tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let relative = path.strip_prefix(root).unwrap();
                out.insert(
                    relative.to_string_lossy().into_owned(),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("`{other}` is not an object"),
    }
}

/// The Ping bot as a payload: the `/ping` command and a reply, the same graph as the
/// `ping` sample project.
pub fn ping_payload() -> Payload {
    let mut payload = Payload::new("0.1.0");
    payload.flows.push(PayloadFlow {
        name: "ping".to_owned().try_into().unwrap(),
        trigger: 0,
        nodes: vec![
            PayloadNode {
                id: "n1".to_owned().try_into().unwrap(),
                alias: "ping_command".to_owned().try_into().unwrap(),
                kind: "discord.slash_command".to_owned(),
                type_version: 1,
                settings: object(json!({
                    "description": "Replies with pong",
                    "ephemeral": false,
                    "name": "ping"
                })),
                expressions: Vec::new(),
                next: vec![Output {
                    port: "next".to_owned().try_into().unwrap(),
                    to: vec![1],
                }],
            },
            PayloadNode {
                id: "n2".to_owned().try_into().unwrap(),
                alias: "reply".to_owned().try_into().unwrap(),
                kind: "discord.reply".to_owned(),
                type_version: 1,
                settings: object(json!({ "content": "Pong!" })),
                expressions: Vec::new(),
                next: Vec::new(),
            },
        ],
    });
    payload.events.push(EventRoute {
        event: "slash_command".to_owned(),
        flows: vec![0],
    });
    payload.commands.push(CommandDef {
        name: "ping".to_owned(),
        flow: 0,
        hash: "ping-v1".to_owned(),
        definition: object(json!({
            "description": "Replies with pong",
            "name": "ping",
            "type": 1
        })),
    });
    payload.requirements = Requirements {
        intents: vec!["guilds".to_owned()],
        cache: Vec::new(),
        assets: Vec::new(),
    };
    payload
}
