//! Saving and loading a project.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::collections::BTreeMap;
use std::fs;

use graph::{
    Alias, Editor, Flow, FlowName, Line, MAX_FILE_BYTES, MAX_FLOWS, Manifest, Node, NodeId,
    Platform, Port, PortName, Project, ProjectError, Variable, VariableName, VariableScope,
    VariableType,
};
use serde_json::{Map, Value, json};

fn node(id: &str, alias: &str, settings: Value) -> Node {
    Node {
        id: NodeId::parse(id).unwrap(),
        alias: Alias::parse(alias).unwrap(),
        kind: "test.node".to_owned(),
        type_version: 3,
        settings: settings.as_object().unwrap().clone(),
        editor: Editor { x: -12.5, y: 1e-3 },
    }
}

fn line(from: &str, port: &str, to: &str) -> Line {
    Line {
        from: Port {
            node: NodeId::parse(from).unwrap(),
            port: PortName::parse(port).unwrap(),
        },
        to: NodeId::parse(to).unwrap(),
    }
}

fn variable(name: &str, kind: VariableType, scope: VariableScope, initial: Value) -> Variable {
    Variable {
        name: VariableName::parse(name).unwrap(),
        kind,
        scope,
        initial,
    }
}

/// A project with every field filled, several flows and settings of every JSON kind,
/// built with its keys out of order.
fn full_project() -> Project {
    let mut manifest = Manifest::new("Full — ñandú \"quoted\"");
    manifest.settings = json!({"zeta": [3, 2, {"b": 1, "a": null}], "alpha": "x"})
        .as_object()
        .unwrap()
        .clone();
    manifest.variables = vec![
        variable(
            "count",
            VariableType::Integer,
            VariableScope::Member,
            json!(0),
        ),
        variable(
            "ratio",
            VariableType::Decimal,
            VariableScope::Server,
            json!(0.25),
        ),
        variable("motto", VariableType::Text, VariableScope::Bot, json!("hi")),
        variable(
            "flag",
            VariableType::Boolean,
            VariableScope::User,
            json!(false),
        ),
        variable("scratch", VariableType::Text, VariableScope::Run, json!("")),
    ];

    let mut flows = BTreeMap::new();
    flows.insert(
        FlowName::parse("welcome").unwrap(),
        Flow {
            nodes: vec![
                node(
                    "a",
                    "first",
                    json!({"text": "Hi {{ event.user.name }}", "n": 1}),
                ),
                node(
                    "b",
                    "second",
                    json!({"deep": {"z": true, "y": [1.5, "two", null]}}),
                ),
            ],
            lines: vec![line("a", "next", "b"), line("b", "error", "a")],
        },
    );
    flows.insert(FlowName::parse("kick-cmd").unwrap(), Flow::default());
    flows.insert(
        FlowName::parse("ready").unwrap(),
        Flow {
            nodes: vec![node("only", "only", json!({}))],
            lines: vec![],
        },
    );
    Project { manifest, flows }
}

#[test]
fn a_full_project_loads_back_equal() {
    let project = full_project();
    let dir = tempfile::tempdir().unwrap();
    project.save(dir.path()).unwrap();
    let loaded = Project::load(dir.path()).unwrap();
    assert_eq!(loaded.project, project);
    assert_eq!(loaded.migrated_from, None);
}

#[test]
fn saving_twice_gives_the_same_bytes() {
    let project = full_project();
    let dir = tempfile::tempdir().unwrap();
    project.save(dir.path()).unwrap();
    let first = common::read_tree(dir.path());
    Project::load(dir.path())
        .unwrap()
        .project
        .save(dir.path())
        .unwrap();
    assert_eq!(common::read_tree(dir.path()), first);
}

#[test]
fn keys_are_written_in_order_whatever_the_build_order() {
    let dir = tempfile::tempdir().unwrap();
    full_project().save(dir.path()).unwrap();
    let manifest = fs::read_to_string(dir.path().join("bot.botproj")).unwrap();
    assert!(manifest.find("\"alpha\"").unwrap() < manifest.find("\"zeta\"").unwrap());
    let flow = fs::read_to_string(dir.path().join("flows/welcome.flow.json")).unwrap();
    assert!(flow.find("\"y\"").unwrap() < flow.find("\"z\"").unwrap());
    // Struct fields keep their declared order, not the alphabetical one.
    assert!(flow.find("\"id\"").unwrap() < flow.find("\"alias\"").unwrap());
    assert!(manifest.ends_with("}\n"));
}

#[test]
fn flows_are_listed_in_name_order() {
    let dir = tempfile::tempdir().unwrap();
    full_project().save(dir.path()).unwrap();
    let loaded = Project::load(dir.path()).unwrap();
    let names: Vec<_> = loaded
        .project
        .flows
        .keys()
        .map(ToString::to_string)
        .collect();
    assert_eq!(names, ["kick-cmd", "ready", "welcome"]);
}

#[test]
fn save_creates_the_folder_and_a_gitignore_that_keeps_the_token_out() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("deep/new-bot");
    Project {
        manifest: Manifest::new("New"),
        flows: BTreeMap::new(),
    }
    .save(&target)
    .unwrap();
    let gitignore = fs::read_to_string(target.join(".gitignore")).unwrap();
    assert!(gitignore.lines().any(|l| l == ".env"));
    assert!(gitignore.lines().any(|l| l == ".botinventor/"));
    assert!(Project::load(&target).unwrap().project.flows.is_empty());
}

#[test]
fn save_removes_deleted_flows_and_leaves_everything_else() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut project = full_project();
    project.save(root).unwrap();

    fs::write(root.join(".env"), "DISCORD_TOKEN=secret\n").unwrap();
    fs::create_dir_all(root.join("assets")).unwrap();
    fs::write(root.join("assets/logo.png"), b"png").unwrap();
    fs::create_dir_all(root.join(".botinventor/data")).unwrap();
    fs::write(root.join(".botinventor/data/bot.sqlite"), b"db").unwrap();
    fs::write(root.join("flows/notes.txt"), "mine").unwrap();
    // A name this crate would never write is not its file to delete.
    fs::write(root.join("flows/Not A Flow.flow.json"), "mine").unwrap();
    fs::write(root.join(".gitignore"), "custom\n").unwrap();

    project.flows.remove(&FlowName::parse("welcome").unwrap());
    project.save(root).unwrap();

    assert!(!root.join("flows/welcome.flow.json").exists());
    assert!(root.join("flows/ready.flow.json").exists());
    assert_eq!(
        fs::read_to_string(root.join(".env")).unwrap(),
        "DISCORD_TOKEN=secret\n"
    );
    assert_eq!(fs::read(root.join("assets/logo.png")).unwrap(), b"png");
    assert_eq!(
        fs::read(root.join(".botinventor/data/bot.sqlite")).unwrap(),
        b"db"
    );
    assert_eq!(
        fs::read_to_string(root.join("flows/notes.txt")).unwrap(),
        "mine"
    );
    assert!(root.join("flows/Not A Flow.flow.json").exists());
    assert_eq!(
        fs::read_to_string(root.join(".gitignore")).unwrap(),
        "custom\n"
    );
}

#[test]
fn save_leaves_no_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    full_project().save(dir.path()).unwrap();
    // A leftover from a crash does not get in the way either.
    fs::write(dir.path().join("bot.botproj.tmp"), "half").unwrap();
    full_project().save(dir.path()).unwrap();
    let leftovers: Vec<_> = common::read_tree(dir.path())
        .into_keys()
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn a_leftover_temporary_flow_file_is_not_a_flow() {
    let dir = tempfile::tempdir().unwrap();
    full_project().save(dir.path()).unwrap();
    fs::write(dir.path().join("flows/ghost.flow.json.tmp"), "{").unwrap();
    assert_eq!(Project::load(dir.path()).unwrap().project.flows.len(), 3);
}

fn assert_nothing_written(dir: &std::path::Path) {
    assert_eq!(
        fs::read_dir(dir).unwrap().count(),
        0,
        "the folder must stay empty"
    );
}

#[test]
fn a_project_that_could_not_be_loaded_back_is_not_saved() {
    let dir = tempfile::tempdir().unwrap();

    let mut old = full_project();
    old.manifest.format_version = 7;
    assert!(matches!(
        old.save(dir.path()),
        Err(ProjectError::UnsavableVersion { found: 7, .. })
    ));

    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut project = full_project();
        let flow = project
            .flows
            .get_mut(&FlowName::parse("welcome").unwrap())
            .unwrap();
        flow.nodes[0].editor.y = bad;
        let error = project.save(dir.path()).unwrap_err();
        assert!(
            matches!(error, ProjectError::NonFinitePosition { .. }),
            "{error}"
        );
        assert!(error.to_string().contains("welcome"), "{error}");
    }

    let mut huge = full_project();
    let mut settings = Map::new();
    let big = usize::try_from(MAX_FILE_BYTES).unwrap() + 1;
    settings.insert("blob".to_owned(), Value::String("x".repeat(big)));
    huge.manifest.settings = settings;
    assert!(matches!(
        huge.save(dir.path()),
        Err(ProjectError::TooLarge { .. })
    ));

    let mut many = Project {
        manifest: Manifest::new("Many"),
        flows: BTreeMap::new(),
    };
    for i in 0..=MAX_FLOWS {
        many.flows
            .insert(FlowName::parse(&format!("f{i}")).unwrap(), Flow::default());
    }
    assert!(matches!(
        many.save(dir.path()),
        Err(ProjectError::TooManyFlows { .. })
    ));

    assert_nothing_written(dir.path());
}

#[test]
fn the_most_flows_allowed_round_trips() {
    let mut project = Project {
        manifest: Manifest::new("Many"),
        flows: BTreeMap::new(),
    };
    for i in 0..MAX_FLOWS {
        project
            .flows
            .insert(FlowName::parse(&format!("f{i}")).unwrap(), Flow::default());
    }
    let dir = tempfile::tempdir().unwrap();
    project.save(dir.path()).unwrap();
    assert_eq!(Project::load(dir.path()).unwrap().project, project);
}

#[test]
fn the_platform_is_written_in_lowercase() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = full_project();
    project.manifest.platform = Platform::Discord;
    project.save(dir.path()).unwrap();
    let manifest = fs::read_to_string(dir.path().join("bot.botproj")).unwrap();
    assert!(manifest.contains("\"platform\": \"discord\""), "{manifest}");
}

#[cfg(unix)]
#[test]
fn save_refuses_a_flows_folder_that_is_a_link() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), dir.path().join("flows")).unwrap();
    let error = full_project().save(dir.path()).unwrap_err();
    assert!(matches!(error, ProjectError::Symlink { .. }), "{error}");
    assert_eq!(fs::read_dir(elsewhere.path()).unwrap().count(), 0);
}
