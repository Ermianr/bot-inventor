//! The sample projects of every format version (`tests/samples/v<N>/<project>/`).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::fs;

use graph::{CURRENT_FORMAT_VERSION, Project};

/// `(version, project folder)` for every sample.
fn samples() -> Vec<(u32, std::path::PathBuf)> {
    let mut found = Vec::new();
    for version_dir in fs::read_dir(common::samples_dir()).unwrap() {
        let version_dir = version_dir.unwrap().path();
        let name = version_dir
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let version: u32 = name
            .strip_prefix('v')
            .and_then(|n| n.parse().ok())
            .unwrap_or_else(|| panic!("`{name}` is not a `v<N>` folder"));
        for project in fs::read_dir(&version_dir).unwrap() {
            found.push((version, project.unwrap().path()));
        }
    }
    found
}

#[test]
fn every_format_version_has_a_sample() {
    let samples = samples();
    for version in 1..=CURRENT_FORMAT_VERSION {
        assert!(
            samples.iter().any(|(v, _)| *v == version),
            "no sample project for format version {version} in tests/samples/v{version}/"
        );
    }
    assert!(
        samples.iter().all(|(v, _)| *v <= CURRENT_FORMAT_VERSION),
        "a sample is newer than the current format version"
    );
}

#[test]
fn every_sample_loads() {
    for (version, path) in samples() {
        let loaded = Project::load(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let expected = (version < CURRENT_FORMAT_VERSION).then_some(version);
        assert_eq!(loaded.migrated_from, expected, "{}", path.display());
        assert_eq!(
            loaded.project.manifest.format_version,
            CURRENT_FORMAT_VERSION
        );
    }
}

#[test]
fn the_ping_sample_has_what_the_milestone_needs() {
    let loaded = Project::load(&common::samples_dir().join("v1/ping")).unwrap();
    let manifest = &loaded.project.manifest;
    assert_eq!(manifest.name, "Ping");
    let flow = loaded.project.flows.values().next().unwrap();
    assert_eq!(loaded.project.flows.len(), 1);
    assert_eq!(flow.nodes.len(), 2);
    assert_eq!(flow.lines.len(), 1);
}

#[test]
fn the_current_samples_save_to_the_same_bytes() {
    for (version, path) in samples() {
        if version != CURRENT_FORMAT_VERSION {
            continue;
        }
        let loaded = Project::load(&path).unwrap();
        let out = tempfile::tempdir().unwrap();
        loaded.project.save(out.path()).unwrap();
        assert_eq!(
            common::read_tree(out.path()),
            common::read_tree(&path),
            "{}",
            path.display()
        );
    }
}
