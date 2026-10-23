//! The footer of an exported bot: `[runner][payload][footer]`.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use std::io::{Cursor, Seek, SeekFrom, Write};

use graph::{
    CONTAINER_VERSION, FOOTER_LEN, MAGIC, MAX_PAYLOAD_BYTES, Payload, PayloadError, read_container,
    write_container,
};

/// Stand-in for the bytes of the runner executable.
const RUNNER: &[u8] = b"\x7fELF this is the runner, it is not a real executable";

fn payload_bytes() -> Vec<u8> {
    common::ping_payload().encode().unwrap()
}

fn container(payload: &[u8]) -> Vec<u8> {
    let mut out = RUNNER.to_vec();
    write_container(&mut out, payload).unwrap();
    out
}

/// A footer written by hand, to make one that `write_container` would not.
fn footer(magic: [u8; 8], version: u32, length: u64) -> Vec<u8> {
    let mut out = magic.to_vec();
    out.extend_from_slice(&version.to_le_bytes());
    out.extend_from_slice(&length.to_le_bytes());
    out
}

#[track_caller]
fn read(bytes: Vec<u8>) -> Result<Option<Vec<u8>>, PayloadError> {
    read_container(&mut Cursor::new(bytes))
}

#[test]
fn the_footer_is_a_magic_a_version_and_a_length() {
    let payload = payload_bytes();
    let bytes = container(&payload);
    assert_eq!(bytes.len(), RUNNER.len() + payload.len() + FOOTER_LEN);
    assert_eq!(
        bytes[RUNNER.len() + payload.len()..],
        footer(MAGIC, CONTAINER_VERSION, payload.len() as u64)[..]
    );
}

#[test]
fn the_payload_is_found_at_the_end_of_the_file() {
    let payload = payload_bytes();
    let found = read(container(&payload)).unwrap().unwrap();
    assert_eq!(found, payload);
    assert_eq!(Payload::decode(&found).unwrap(), common::ping_payload());
}

#[test]
fn it_works_on_a_real_file() {
    let payload = payload_bytes();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("my-bot");
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(RUNNER).unwrap();
    write_container(&mut file, &payload).unwrap();
    drop(file);

    let mut file = std::fs::File::open(&path).unwrap();
    assert_eq!(read_container(&mut file).unwrap().unwrap(), payload);
    // The reader leaves the file usable.
    file.seek(SeekFrom::Start(0)).unwrap();
    assert_eq!(read_container(&mut file).unwrap().unwrap(), payload);
}

#[test]
fn a_file_with_no_footer_is_told_apart() {
    assert_eq!(read(Vec::new()).unwrap(), None);
    assert_eq!(read(vec![1; FOOTER_LEN - 1]).unwrap(), None);
    assert_eq!(read(vec![0; FOOTER_LEN]).unwrap(), None);
    assert_eq!(read(RUNNER.to_vec()).unwrap(), None);
    // A raw payload file has no footer either.
    assert_eq!(read(payload_bytes()).unwrap(), None);
}

#[test]
fn a_file_cut_inside_the_footer_has_no_footer() {
    let bytes = container(&payload_bytes());
    for cut in 1..FOOTER_LEN {
        assert_eq!(read(bytes[..bytes.len() - cut].to_vec()).unwrap(), None);
    }
}

#[test]
fn a_wrong_magic_is_not_a_footer() {
    let mut bytes = container(&payload_bytes());
    let magic_at = bytes.len() - FOOTER_LEN;
    bytes[magic_at] ^= 0xff;
    assert_eq!(read(bytes).unwrap(), None);
}

#[test]
fn a_newer_container_version_says_to_update() {
    let mut bytes = RUNNER.to_vec();
    bytes.extend_from_slice(&payload_bytes());
    bytes.extend_from_slice(&footer(MAGIC, CONTAINER_VERSION + 1, 10));
    let error = read(bytes).unwrap_err();
    assert!(
        matches!(error, PayloadError::NewerContainer { found, supported }
            if found == CONTAINER_VERSION + 1 && supported == CONTAINER_VERSION),
        "{error}"
    );
    assert!(error.to_string().contains("update Bot Inventor"));
}

#[test]
fn container_version_zero_is_invalid() {
    let mut bytes = RUNNER.to_vec();
    bytes.extend_from_slice(&footer(MAGIC, 0, 0));
    assert!(matches!(
        read(bytes).unwrap_err(),
        PayloadError::InvalidContainer
    ));
}

#[test]
fn a_length_larger_than_the_file_is_refused() {
    let mut bytes = RUNNER.to_vec();
    let room = bytes.len() as u64;
    bytes.extend_from_slice(&footer(MAGIC, CONTAINER_VERSION, room + 1));
    let error = read(bytes).unwrap_err();
    assert!(
        matches!(error, PayloadError::BadContainerLength { length, available }
            if length == room + 1 && available == room),
        "{error}"
    );

    let mut bytes = RUNNER.to_vec();
    bytes.extend_from_slice(&footer(MAGIC, CONTAINER_VERSION, u64::MAX));
    assert!(matches!(
        read(bytes).unwrap_err(),
        PayloadError::BadContainerLength { .. }
    ));
}

#[test]
fn a_length_over_the_payload_limit_is_refused_without_reading_it() {
    let length = MAX_PAYLOAD_BYTES as u64 + 1;
    let mut bytes = vec![0_u8; usize::try_from(length).unwrap()];
    bytes.extend_from_slice(&footer(MAGIC, CONTAINER_VERSION, length));
    assert!(matches!(
        read(bytes).unwrap_err(),
        PayloadError::TooLarge { .. }
    ));
}

#[test]
fn write_refuses_a_payload_that_could_not_be_read_back() {
    let mut out = Vec::new();
    let error = write_container(&mut out, &vec![0_u8; MAX_PAYLOAD_BYTES + 1]).unwrap_err();
    assert!(matches!(error, PayloadError::TooLarge { .. }));
    assert!(out.is_empty(), "nothing is written when it is refused");
}

#[test]
fn an_empty_payload_is_a_valid_container_but_not_a_valid_payload() {
    let found = read(container(&[])).unwrap().unwrap();
    assert!(found.is_empty());
    assert!(matches!(Payload::decode(&found), Err(PayloadError::Empty)));
}

#[test]
fn a_damaged_payload_inside_the_container_is_caught_by_the_payload_checksum() {
    let mut payload = payload_bytes();
    let last = payload.len() - 1;
    payload[last] ^= 0xff;
    let found = read(container(&payload)).unwrap().unwrap();
    assert!(Payload::decode(&found).is_err());
}
