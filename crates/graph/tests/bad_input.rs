//! Bad project files: each one must come back as an error that names the file, and
//! none may panic.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::fs;
use std::path::Path;

use graph::{MAX_FILE_BYTES, MAX_FLOWS, Project, ProjectError};

const MANIFEST: &str = r#"{
  "format_version": 1,
  "name": "Bad",
  "platform": "discord",
  "settings": {},
  "variables": []
}"#;

const FLOW: &str = r#"{
  "nodes": [
    {
      "id": "n1",
      "alias": "start",
      "type": "t",
      "type_version": 1,
      "settings": {},
      "editor": { "x": 0.0, "y": 0.0 }
    }
  ],
  "lines": [ { "from": { "node": "n1", "port": "next" }, "to": "n1" } ]
}"#;

/// A project folder with the given manifest and flow files.
fn project(manifest: &[u8], flows: &[(&str, &[u8])]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("bot.botproj"), manifest).unwrap();
    fs::create_dir(dir.path().join("flows")).unwrap();
    for (name, content) in flows {
        fs::write(dir.path().join("flows").join(name), content).unwrap();
    }
    dir
}

fn error_of(dir: &Path) -> ProjectError {
    match Project::load(dir) {
        Ok(_) => panic!("the project loaded, but it should have been refused"),
        Err(error) => error,
    }
}

/// The project is refused with a message that contains every part of `parts`.
#[track_caller]
fn refused(dir: &tempfile::TempDir, parts: &[&str]) -> ProjectError {
    let error = error_of(dir.path());
    let message = error.to_string();
    for part in parts {
        assert!(
            message.contains(part),
            "`{message}` should contain `{part}`"
        );
    }
    error
}

#[test]
fn the_good_project_loads() {
    let dir = project(MANIFEST.as_bytes(), &[("a.flow.json", FLOW.as_bytes())]);
    Project::load(dir.path()).unwrap();
}

#[test]
fn bad_manifests() {
    let with_manifest = |text: &str| project(text.as_bytes(), &[]);
    let replace = |from: &str, to: &str| {
        assert!(MANIFEST.contains(from), "the case is stale: {from}");
        MANIFEST.replacen(from, to, 1)
    };

    let cases: Vec<(&str, String, Vec<&str>)> = vec![
        ("empty file", String::new(), vec!["bot.botproj"]),
        ("not JSON", "not json".into(), vec!["bot.botproj", "line 1"]),
        ("cut off", MANIFEST[..40].into(), vec!["bot.botproj"]),
        ("a list", "[]".into(), vec!["bot.botproj"]),
        ("null", "null".into(), vec!["bot.botproj"]),
        (
            "trailing text",
            format!("{MANIFEST} x"),
            vec!["bot.botproj", "trailing"],
        ),
        (
            "name of the wrong type",
            replace("\"Bad\"", "5"),
            vec!["bot.botproj", "invalid type", "line"],
        ),
        (
            "missing field",
            replace("  \"name\": \"Bad\",\n", ""),
            vec!["bot.botproj", "missing field `name`"],
        ),
        (
            "unknown field",
            replace("\"variables\": []", "\"variables\": [], \"extra\": 1"),
            vec!["bot.botproj", "unknown field `extra`"],
        ),
        (
            "unknown platform",
            replace("discord", "telegram"),
            vec!["bot.botproj", "unknown variant `telegram`"],
        ),
        (
            "settings not an object",
            replace("\"settings\": {}", "\"settings\": 3"),
            vec!["bot.botproj", "invalid type"],
        ),
        (
            "bad variable name",
            replace(
                "\"variables\": []",
                r#""variables": [{"name":"Bad Name","type":"text","scope":"bot","initial":""}]"#,
            ),
            vec!["bot.botproj", "variable name `Bad Name`"],
        ),
        (
            "bad variable type",
            replace(
                "\"variables\": []",
                r#""variables": [{"name":"x","type":"float","scope":"bot","initial":0}]"#,
            ),
            vec!["bot.botproj", "unknown variant `float`"],
        ),
        (
            "bad variable scope",
            replace(
                "\"variables\": []",
                r#""variables": [{"name":"x","type":"text","scope":"guild","initial":""}]"#,
            ),
            vec!["bot.botproj", "unknown variant `guild`"],
        ),
        (
            "variable without initial",
            replace(
                "\"variables\": []",
                r#""variables": [{"name":"x","type":"text","scope":"bot"}]"#,
            ),
            vec!["bot.botproj", "missing field `initial`"],
        ),
        (
            "deeply nested settings",
            replace(
                "\"settings\": {}",
                &format!(
                    "\"settings\": {{\"a\": {}{}}}",
                    "[".repeat(100_000),
                    "]".repeat(100_000)
                ),
            ),
            vec!["bot.botproj", "recursion limit"],
        ),
    ];

    for (label, text, parts) in &cases {
        let dir = with_manifest(text);
        let error = error_of(dir.path());
        let message = error.to_string();
        for part in parts {
            assert!(
                message.contains(part),
                "{label}: `{message}` should contain `{part}`"
            );
        }
    }
}

#[test]
fn bad_format_versions() {
    let with_version = |version: &str| {
        project(
            MANIFEST
                .replacen(
                    "\"format_version\": 1",
                    &format!("\"format_version\": {version}"),
                    1,
                )
                .as_bytes(),
            &[],
        )
    };

    for bad in [
        "0", "-1", "1.5", "1.0", "\"1\"", "null", "true", "[1]", "{}",
    ] {
        let error = refused(&with_version(bad), &["bot.botproj", "format_version"]);
        assert!(
            matches!(error, ProjectError::InvalidVersion { .. }),
            "{bad}: {error}"
        );
    }

    let missing = project(
        MANIFEST
            .replacen("  \"format_version\": 1,\n", "", 1)
            .as_bytes(),
        &[],
    );
    let error = refused(&missing, &["format_version"]);
    assert!(
        matches!(error, ProjectError::InvalidVersion { .. }),
        "{error}"
    );

    for newer in ["2", "99", "4294967296", "18446744073709551615"] {
        let error = refused(
            &with_version(newer),
            &["bot.botproj", "supports up to 1", "update Bot Inventor"],
        );
        assert!(
            matches!(error, ProjectError::NewerFormat { supported: 1, .. }),
            "{newer}: {error}"
        );
    }
    let message = error_of(with_version("7").path()).to_string();
    assert!(message.contains("format_version 7"), "{message}");
}

#[test]
fn a_newer_version_is_refused_before_the_rest_is_read() {
    // The newer format may have fields this version does not know, and a flow that
    // does not parse: the version is what the message must talk about.
    let manifest = MANIFEST
        .replacen("\"format_version\": 1", "\"format_version\": 2", 1)
        .replacen(
            "\"variables\": []",
            "\"variables\": [], \"future\": true",
            1,
        );
    let dir = project(manifest.as_bytes(), &[("a.flow.json", b"{ not json")]);
    let error = refused(&dir, &["format_version 2"]);
    assert!(matches!(error, ProjectError::NewerFormat { .. }), "{error}");
}

#[test]
fn bad_flows() {
    let replace = |from: &str, to: &str| {
        assert!(FLOW.contains(from), "the case is stale: {from}");
        FLOW.replacen(from, to, 1)
    };

    let cases: Vec<(&str, String, Vec<&str>)> = vec![
        ("empty file", String::new(), vec!["a.flow.json"]),
        ("not JSON", "{".into(), vec!["a.flow.json"]),
        ("a list", "[]".into(), vec!["a.flow.json"]),
        (
            "no nodes field",
            r#"{"lines": []}"#.into(),
            vec!["missing field `nodes`"],
        ),
        (
            "no lines field",
            r#"{"nodes": []}"#.into(),
            vec!["missing field `lines`"],
        ),
        (
            "unknown flow field",
            r#"{"nodes": [], "lines": [], "trigger": "n1"}"#.into(),
            vec!["unknown field `trigger`"],
        ),
        (
            "bad node id",
            replace("\"n1\",\n      \"alias\"", "\"n 1\",\n      \"alias\""),
            vec!["node id `n 1`"],
        ),
        (
            "empty node id",
            replace("\"n1\",\n      \"alias\"", "\"\",\n      \"alias\""),
            vec!["node id ``"],
        ),
        (
            "bad alias",
            replace("\"start\"", "\"Start\""),
            vec!["alias `Start`"],
        ),
        (
            "alias starts with a digit",
            replace("\"start\"", "\"1st\""),
            vec!["alias `1st`"],
        ),
        (
            "bad port",
            replace("\"next\"", "\"Next\""),
            vec!["port name `Next`"],
        ),
        (
            "type of the wrong kind",
            replace("\"type\": \"t\"", "\"type\": 7"),
            vec!["invalid type"],
        ),
        (
            "negative type_version",
            replace("\"type_version\": 1", "\"type_version\": -1"),
            vec!["invalid value"],
        ),
        (
            "fractional type_version",
            replace("\"type_version\": 1", "\"type_version\": 1.5"),
            vec!["invalid type"],
        ),
        (
            "settings missing",
            replace("      \"settings\": {},\n", ""),
            vec!["missing field `settings`"],
        ),
        (
            "settings a list",
            replace("\"settings\": {}", "\"settings\": []"),
            vec!["invalid type"],
        ),
        (
            "editor missing",
            replace(",\n      \"editor\": { \"x\": 0.0, \"y\": 0.0 }", ""),
            vec!["missing field `editor`"],
        ),
        (
            "editor x as text",
            replace("\"x\": 0.0", "\"x\": \"0\""),
            vec!["invalid type"],
        ),
        (
            "editor x out of range",
            replace("\"x\": 0.0", "\"x\": 1e999"),
            vec!["out of range"],
        ),
        (
            "unknown node field",
            replace(
                "\"type_version\": 1,",
                "\"type_version\": 1, \"color\": \"red\",",
            ),
            vec!["unknown field `color`"],
        ),
        (
            "line to is a number",
            replace("\"to\": \"n1\"", "\"to\": 1"),
            vec!["invalid type"],
        ),
        (
            "line to is bad",
            replace("\"to\": \"n1\"", "\"to\": \"../x\""),
            vec!["node id `../x`"],
        ),
        (
            "line without from",
            replace("\"from\": { \"node\": \"n1\", \"port\": \"next\" }, ", ""),
            vec!["missing field `from`"],
        ),
        (
            "line from without port",
            replace(", \"port\": \"next\"", ""),
            vec!["missing field `port`"],
        ),
    ];

    for (label, text, parts) in &cases {
        let dir = project(MANIFEST.as_bytes(), &[("a.flow.json", text.as_bytes())]);
        let error = error_of(dir.path());
        let message = error.to_string();
        assert!(
            message.contains("a.flow.json"),
            "{label}: `{message}` should name the file"
        );
        for part in parts {
            assert!(
                message.contains(part),
                "{label}: `{message}` should contain `{part}`"
            );
        }
    }
}

#[test]
fn invalid_utf8_is_refused_whatever_the_file() {
    let bad = [b'{', 0xff, 0xfe, b'}'];
    let manifest = project(&bad, &[]);
    let error = refused(&manifest, &["bot.botproj", "UTF-8"]);
    assert!(matches!(error, ProjectError::NotUtf8 { .. }));

    let flow = project(MANIFEST.as_bytes(), &[("a.flow.json", &bad)]);
    let error = refused(&flow, &["a.flow.json", "UTF-8"]);
    assert!(matches!(error, ProjectError::NotUtf8 { .. }));

    // A byte-order mark is not JSON either.
    let bom = project(&[0xef, 0xbb, 0xbf, b'{', b'}'], &[]);
    error_of(bom.path());
}

#[test]
fn a_file_over_the_limit_is_refused() {
    let size = usize::try_from(MAX_FILE_BYTES).unwrap() + 1;
    let padding = " ".repeat(size);

    let manifest = project(format!("{MANIFEST}{padding}").as_bytes(), &[]);
    let error = refused(&manifest, &["bot.botproj", "larger than"]);
    assert!(matches!(error, ProjectError::TooLarge { .. }));

    let flow = project(
        MANIFEST.as_bytes(),
        &[("a.flow.json", format!("{FLOW}{padding}").as_bytes())],
    );
    let error = refused(&flow, &["a.flow.json", "larger than"]);
    assert!(matches!(error, ProjectError::TooLarge { .. }));
}

#[test]
fn a_file_exactly_at_the_limit_is_read() {
    let size = usize::try_from(MAX_FILE_BYTES).unwrap() - MANIFEST.len();
    let dir = project(format!("{MANIFEST}{}", " ".repeat(size)).as_bytes(), &[]);
    Project::load(dir.path()).unwrap();
}

#[test]
fn too_many_flows_are_refused() {
    let names: Vec<String> = (0..=MAX_FLOWS).map(|i| format!("f{i}.flow.json")).collect();
    let flows: Vec<(&str, &[u8])> = names
        .iter()
        .map(|n| (n.as_str(), FLOW.as_bytes()))
        .collect();
    let dir = project(MANIFEST.as_bytes(), &flows);
    let error = refused(&dir, &["257 flows", "256"]);
    assert!(matches!(error, ProjectError::TooManyFlows { .. }));
}

#[test]
fn bad_flow_file_names_are_refused() {
    for bad in [
        "Not A Flow.flow.json",
        ".flow.json",
        "UPPER.flow.json",
        "a.b.flow.json",
        "-x.flow.json",
    ] {
        let dir = project(MANIFEST.as_bytes(), &[(bad, FLOW.as_bytes())]);
        let error = refused(&dir, &[bad.trim_end_matches(".flow.json")]);
        assert!(
            matches!(error, ProjectError::InvalidFlowFileName { .. }),
            "{bad}: {error}"
        );
    }
}

#[test]
fn files_that_are_not_flows_are_ignored() {
    let dir = project(
        MANIFEST.as_bytes(),
        &[
            ("a.flow.json", FLOW.as_bytes()),
            ("a.flow.json.tmp", b"{"),
            ("README.md", b"x"),
            ("b.json", b"{"),
        ],
    );
    fs::create_dir(dir.path().join("flows/subfolder")).unwrap();
    assert_eq!(Project::load(dir.path()).unwrap().project.flows.len(), 1);
}

#[test]
fn a_missing_manifest_says_it_is_not_a_project() {
    let dir = tempfile::tempdir().unwrap();
    let error = refused(&dir, &["bot.botproj", "not a Bot Inventor project"]);
    assert!(matches!(error, ProjectError::MissingManifest { .. }));

    let missing = dir.path().join("nowhere");
    assert!(matches!(
        error_of(&missing),
        ProjectError::MissingManifest { .. }
    ));
}

#[test]
fn a_project_without_a_flows_folder_has_no_flows() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("bot.botproj"), MANIFEST).unwrap();
    assert!(Project::load(dir.path()).unwrap().project.flows.is_empty());
}

#[test]
fn things_of_the_wrong_kind_are_refused() {
    // The manifest is a folder.
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("bot.botproj")).unwrap();
    let error = refused(&dir, &["bot.botproj", "not a regular file"]);
    assert!(matches!(error, ProjectError::NotAFile { .. }));

    // `flows` is a file.
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("bot.botproj"), MANIFEST).unwrap();
    fs::write(dir.path().join("flows"), "x").unwrap();
    let error = refused(&dir, &["flows", "not a folder"]);
    assert!(matches!(error, ProjectError::NotAFolder { .. }));

    // A flow file is a folder.
    let dir = project(MANIFEST.as_bytes(), &[]);
    fs::create_dir(dir.path().join("flows/a.flow.json")).unwrap();
    let error = refused(&dir, &["a.flow.json", "not a regular file"]);
    assert!(matches!(error, ProjectError::NotAFile { .. }));
}

#[cfg(unix)]
#[test]
fn links_are_not_followed() {
    use std::os::unix::fs::symlink;

    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("bot.botproj"), MANIFEST).unwrap();
    fs::write(outside.path().join("a.flow.json"), FLOW).unwrap();

    // The manifest.
    let dir = tempfile::tempdir().unwrap();
    symlink(
        outside.path().join("bot.botproj"),
        dir.path().join("bot.botproj"),
    )
    .unwrap();
    let error = refused(&dir, &["bot.botproj", "symbolic link"]);
    assert!(matches!(error, ProjectError::Symlink { .. }));

    // The `flows` folder.
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("bot.botproj"), MANIFEST).unwrap();
    symlink(outside.path(), dir.path().join("flows")).unwrap();
    let error = refused(&dir, &["flows", "symbolic link"]);
    assert!(matches!(error, ProjectError::Symlink { .. }));

    // One flow file.
    let dir = project(MANIFEST.as_bytes(), &[]);
    symlink(
        outside.path().join("a.flow.json"),
        dir.path().join("flows/a.flow.json"),
    )
    .unwrap();
    let error = refused(&dir, &["a.flow.json", "symbolic link"]);
    assert!(matches!(error, ProjectError::Symlink { .. }));

    // A link to nowhere is a link too.
    let dir = project(MANIFEST.as_bytes(), &[]);
    symlink("/nonexistent/place", dir.path().join("flows/a.flow.json")).unwrap();
    let error = refused(&dir, &["a.flow.json"]);
    assert!(matches!(error, ProjectError::Symlink { .. }));
}
