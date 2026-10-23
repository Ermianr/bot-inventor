//! The sample payloads of every payload version (`tests/payload_samples/v<N>/`): the bytes
//! of the Ping payload (`ping.payload`) and their JSON dump (`ping.json`).
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use graph::{CURRENT_PAYLOAD_VERSION, Payload, PayloadError, dump_json};

fn samples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/payload_samples")
}

fn sample(version: u32, file: &str) -> Vec<u8> {
    let path = samples_dir().join(format!("v{version}")).join(file);
    fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn every_payload_version_has_a_sample() {
    for version in 1..=CURRENT_PAYLOAD_VERSION {
        for file in ["ping.payload", "ping.json"] {
            let path = samples_dir().join(format!("v{version}")).join(file);
            assert!(
                path.is_file(),
                "no sample payload for version {version}: {} is missing",
                path.display()
            );
        }
    }
    for entry in fs::read_dir(samples_dir()).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        let version: u32 = name
            .strip_prefix('v')
            .and_then(|n| n.parse().ok())
            .unwrap_or_else(|| panic!("`{name}` is not a `v<N>` folder"));
        assert!(
            version <= CURRENT_PAYLOAD_VERSION,
            "a sample is newer than the current payload version"
        );
    }
}

#[test]
fn the_current_sample_loads() {
    let bytes = sample(CURRENT_PAYLOAD_VERSION, "ping.payload");
    let payload = Payload::decode(&bytes).unwrap();
    assert_eq!(payload, common::ping_payload());

    let json = sample(CURRENT_PAYLOAD_VERSION, "ping.json");
    let from_json: Payload = serde_json::from_slice(&json).unwrap();
    assert_eq!(payload, from_json);
}

#[test]
fn the_dump_of_the_sample_is_its_json() {
    let bytes = sample(CURRENT_PAYLOAD_VERSION, "ping.payload");
    let json = sample(CURRENT_PAYLOAD_VERSION, "ping.json");
    assert_eq!(
        dump_json(&bytes).unwrap() + "\n",
        String::from_utf8(json).unwrap()
    );
}

#[test]
fn the_samples_of_older_versions_are_refused_with_a_message_to_export_again() {
    // Empty while version 1 is the only one.
    for version in (1..=CURRENT_PAYLOAD_VERSION).filter(|v| *v < CURRENT_PAYLOAD_VERSION) {
        let error = Payload::decode(&sample(version, "ping.payload")).unwrap_err();
        assert!(
            matches!(error, PayloadError::OlderVersion { found, .. } if found == version),
            "{error}"
        );
    }
}

/// Writes the samples of the current version again. While there is no release, a change
/// to the payload regenerates them (`DECISIONS.md`); once a version is released its
/// sample is never written again.
///
/// `cargo test -p graph --test payload_samples -- --ignored regenerate`
#[test]
#[ignore = "writes the sample files"]
fn regenerate() {
    let dir = samples_dir().join(format!("v{CURRENT_PAYLOAD_VERSION}"));
    fs::create_dir_all(&dir).unwrap();
    let payload = common::ping_payload();
    fs::write(dir.join("ping.payload"), payload.encode().unwrap()).unwrap();
    fs::write(dir.join("ping.json"), payload.to_json().unwrap() + "\n").unwrap();
}
