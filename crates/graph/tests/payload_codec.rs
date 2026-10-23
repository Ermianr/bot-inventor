//! The payload codec: round trips, bad payloads, versions and limits. Every bad input
//! must come back as an error, and none may panic.
#![allow(clippy::unwrap_used, clippy::panic)]

mod common;

use graph::{
    CURRENT_PAYLOAD_VERSION, MAX_DECOMPRESSED_BYTES, MAX_PAYLOAD_BYTES, Payload, PayloadError,
    dump_json,
};
use serde_json::{Value, json};

/// Compresses raw bytes as zstd, as a payload that does not come from `encode`.
fn zstd_of(content: &[u8]) -> Vec<u8> {
    zstd::stream::encode_all(content, 3).unwrap()
}

/// The ping payload as JSON, to edit and pack again.
fn ping_json() -> Value {
    serde_json::to_value(common::ping_payload()).unwrap()
}

/// A payload made of this JSON: MessagePack inside zstd.
fn pack(value: &Value) -> Vec<u8> {
    zstd_of(&rmp_serde::to_vec_named(value).unwrap())
}

#[track_caller]
fn refused(bytes: &[u8]) -> PayloadError {
    match Payload::decode(bytes) {
        Ok(_) => panic!("the payload decoded, but it should have been refused"),
        Err(error) => error,
    }
}

#[track_caller]
fn refused_with(bytes: &[u8], parts: &[&str]) -> PayloadError {
    let error = refused(bytes);
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
fn a_payload_round_trips() {
    let payload = common::ping_payload();
    let bytes = payload.encode().unwrap();
    assert_eq!(Payload::decode(&bytes).unwrap(), payload);
}

#[test]
fn the_same_payload_gives_the_same_bytes() {
    let payload = common::ping_payload();
    assert_eq!(payload.encode().unwrap(), payload.encode().unwrap());
}

#[test]
fn the_payload_is_zstd_with_a_checksum() {
    let bytes = common::ping_payload().encode().unwrap();
    assert_eq!(bytes[..4], [0x28, 0xb5, 0x2f, 0xfd], "zstd magic number");
    // Bit 2 of the frame header descriptor is the content checksum flag.
    assert_eq!(bytes[4] & 0b100, 0b100, "the content checksum flag");
}

#[test]
fn the_payload_has_no_editor_data() {
    let text = String::from_utf8_lossy(&rmp_serde::to_vec_named(&common::ping_payload()).unwrap())
        .into_owned();
    for word in ["editor", "position", "comment", "group"] {
        assert!(!text.contains(word), "the payload mentions `{word}`");
    }
}

#[test]
fn the_dump_is_json_with_a_stable_order() {
    let bytes = common::ping_payload().encode().unwrap();
    let dump = dump_json(&bytes).unwrap();
    let value: Value = serde_json::from_str(&dump).unwrap();
    assert_eq!(value["version"], CURRENT_PAYLOAD_VERSION);
    assert_eq!(
        value["flows"][0]["nodes"][1]["settings"]["content"],
        "Pong!"
    );
    assert_eq!(dump, dump_json(&bytes).unwrap());
    // The settings are sorted by key, whatever order they were built in.
    let description = dump.find("\"description\"").unwrap();
    let ephemeral = dump.find("\"ephemeral\"").unwrap();
    assert!(description < ephemeral);
}

#[test]
fn empty_and_unrelated_bytes_are_refused() {
    assert!(matches!(refused(&[]), PayloadError::Empty));
    refused_with(b"hello, this is not a payload", &["damaged or is not"]);
    refused_with(&[0x28, 0xb5, 0x2f, 0xfd], &["damaged or is not"]);
}

#[test]
fn a_truncated_payload_is_refused_at_every_length() {
    let bytes = common::ping_payload().encode().unwrap();
    for length in 0..bytes.len() {
        refused(&bytes[..length]);
    }
}

#[test]
fn a_damaged_byte_is_never_accepted_as_something_else() {
    let payload = common::ping_payload();
    let bytes = payload.encode().unwrap();
    for position in 0..bytes.len() {
        for flip in [0x01_u8, 0x80, 0xff] {
            let mut damaged = bytes.clone();
            damaged[position] ^= flip;
            if let Ok(found) = Payload::decode(&damaged) {
                assert_eq!(found, payload, "byte {position} changed the payload");
            }
        }
    }
}

#[test]
fn a_damaged_content_byte_fails_the_checksum() {
    let mut bytes = common::ping_payload().encode().unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    refused_with(&bytes, &["damaged or is not"]);
}

#[test]
fn bytes_after_the_content_are_refused() {
    let mut content = rmp_serde::to_vec_named(&ping_json()).unwrap();
    content.extend_from_slice(&[0xc0, 0xc0, 0xc0]);
    refused_with(&zstd_of(&content), &["3 bytes after"]);
}

#[test]
fn zstd_that_is_not_messagepack_is_refused() {
    refused_with(&zstd_of(b"this is plain text"), &["not valid"]);
    refused_with(&zstd_of(&[]), &["not valid"]);
    // A MessagePack array and a MessagePack integer where a map should be.
    refused_with(&zstd_of(&[0x92, 0x01, 0x02]), &["not valid"]);
    refused_with(&zstd_of(&[0x01]), &["not valid"]);
}

/// A name, a change to the ping JSON that makes it a bad payload, and the part of the
/// message that tells why.
type Case = (&'static str, Box<dyn Fn(&mut Value)>, &'static str);

fn bad_shapes() -> Vec<Case> {
    fn case(
        name: &'static str,
        edit: impl Fn(&mut Value) + 'static,
        message: &'static str,
    ) -> Case {
        (name, Box::new(edit), message)
    }
    vec![
        case(
            "version as text",
            |v| v["version"] = json!("1"),
            "not valid",
        ),
        case(
            "version as a float",
            |v| v["version"] = json!(1.5),
            "not valid",
        ),
        case(
            "a missing field",
            |v| {
                v.as_object_mut().unwrap().remove("events");
            },
            "events",
        ),
        case(
            "a missing node field",
            |v| {
                v["flows"][0]["nodes"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("next");
            },
            "next",
        ),
        case(
            "an unknown field",
            |v| v["extra"] = json!(1),
            "unknown field",
        ),
        case(
            "an unknown node field",
            |v| {
                v["flows"][0]["nodes"][0]["editor"] = json!({"x": 0.0, "y": 0.0});
            },
            "unknown field",
        ),
        case(
            "a bad flow name",
            |v| v["flows"][0]["name"] = json!("Bad Name"),
            "flow name",
        ),
        case(
            "a bad node id",
            |v| v["flows"][0]["nodes"][0]["id"] = json!(""),
            "node id",
        ),
        case(
            "a bad alias",
            |v| v["flows"][0]["nodes"][0]["alias"] = json!("1x"),
            "alias",
        ),
        case(
            "a bad port name",
            |v| {
                v["flows"][0]["nodes"][0]["next"][0]["port"] = json!("Next");
            },
            "port name",
        ),
        case(
            "a bad variable name",
            |v| {
                v["variables"] = json!([{
                    "name": "Bad", "type": "text", "scope": "bot", "initial": ""
                }]);
            },
            "variable name",
        ),
        case(
            "an unknown variable type",
            |v| {
                v["variables"] = json!([{
                    "name": "x", "type": "blob", "scope": "bot", "initial": ""
                }]);
            },
            "blob",
        ),
        case(
            "a negative index",
            |v| {
                v["flows"][0]["nodes"][0]["next"][0]["to"] = json!([-1]);
            },
            "not valid",
        ),
        case(
            "an index over u32",
            |v| {
                v["flows"][0]["nodes"][0]["next"][0]["to"] = json!([4_294_967_296_u64]);
            },
            "not valid",
        ),
        case(
            "flows as an object",
            |v| v["flows"] = json!({}),
            "not valid",
        ),
        case(
            "settings as a list",
            |v| {
                v["flows"][0]["nodes"][0]["settings"] = json!([1]);
            },
            "not valid",
        ),
    ]
}

#[test]
fn a_table_of_bad_shapes_is_refused() {
    for (name, edit, message) in bad_shapes() {
        let mut value = ping_json();
        edit(&mut value);
        let Err(error) = Payload::decode(&pack(&value)) else {
            panic!("{name}: the payload decoded, but it should have been refused");
        };
        assert!(
            error.to_string().contains(message),
            "{name}: `{error}` should contain `{message}`"
        );
    }
}

#[test]
fn an_index_that_points_nowhere_is_refused() {
    let cases: Vec<Case> = vec![
        (
            "a line to a node that does not exist",
            Box::new(|v| v["flows"][0]["nodes"][0]["next"][0]["to"] = json!([2])),
            "the line goes to node 2",
        ),
        (
            "a trigger outside the nodes",
            Box::new(|v| v["flows"][0]["trigger"] = json!(5)),
            "the trigger is node 5",
        ),
        (
            "an event that points to a missing flow",
            Box::new(|v| v["events"][0]["flows"] = json!([0, 1])),
            "event `slash_command` points to flow 1",
        ),
        (
            "a command that points to a missing flow",
            Box::new(|v| v["commands"][0]["flow"] = json!(7)),
            "command `ping` points to flow 7",
        ),
        (
            "a flow with no nodes",
            Box::new(|v| v["flows"][0]["nodes"] = json!([])),
            "the trigger is node 0, but the flow has 0 nodes",
        ),
    ];
    for (name, edit, message) in cases {
        let mut value = ping_json();
        edit(&mut value);
        let error = refused(&pack(&value));
        assert!(
            matches!(error, PayloadError::Inconsistent(_)),
            "{name}: {error}"
        );
        assert!(
            error.to_string().contains(message),
            "{name}: `{error}` should contain `{message}`"
        );
    }
}

#[test]
fn encode_refuses_what_decode_would_refuse() {
    let mut payload = common::ping_payload();
    payload.commands[0].flow = 3;
    assert!(matches!(
        payload.encode(),
        Err(PayloadError::Inconsistent(_))
    ));

    let mut payload = common::ping_payload();
    payload.version = CURRENT_PAYLOAD_VERSION + 1;
    assert!(matches!(
        payload.encode(),
        Err(PayloadError::NewerVersion { .. })
    ));
}

#[test]
fn version_zero_is_invalid() {
    let mut value = ping_json();
    value["version"] = json!(0);
    assert!(matches!(
        refused(&pack(&value)),
        PayloadError::InvalidVersion
    ));
}

#[test]
fn a_newer_version_is_refused_for_its_version_whatever_its_shape() {
    let newer = CURRENT_PAYLOAD_VERSION + 1;
    let mut value = ping_json();
    value["version"] = json!(newer);
    let shapes = [
        value,
        json!({ "version": newer }),
        json!({ "version": newer, "flows": "no longer a list", "something": [1, 2] }),
    ];
    for shape in shapes {
        let error = refused(&pack(&shape));
        assert!(
            matches!(
                error,
                PayloadError::NewerVersion { found, supported }
                    if found == newer && supported == CURRENT_PAYLOAD_VERSION
            ),
            "{error}"
        );
        assert!(error.to_string().contains("update Bot Inventor"));
    }
}

#[test]
fn a_zstd_bomb_is_read_only_up_to_the_limit() {
    // 65 MiB of zeros compress to a few kilobytes.
    let bomb = zstd_of(&vec![0_u8; MAX_DECOMPRESSED_BYTES + 1024 * 1024]);
    assert!(
        bomb.len() < 64 * 1024,
        "the bomb is small: {} bytes",
        bomb.len()
    );
    assert!(matches!(
        refused(&bomb),
        PayloadError::TooLarge {
            when: "once decompressed",
            ..
        }
    ));
}

#[test]
fn bytes_over_the_compressed_limit_are_refused() {
    let big = vec![0_u8; MAX_PAYLOAD_BYTES + 1];
    assert!(matches!(
        refused(&big),
        PayloadError::TooLarge {
            when: "compressed",
            ..
        }
    ));
}

#[test]
fn a_frame_that_asks_for_a_huge_window_is_refused() {
    // Window log 31 (2 GiB): zstd's own default would accept up to 128 MiB, and the
    // decoder here accepts 64 MiB at most.
    let mut encoder = zstd::stream::write::Encoder::new(Vec::new(), 3).unwrap();
    encoder.window_log(31).unwrap();
    std::io::Write::write_all(
        &mut encoder,
        &rmp_serde::to_vec_named(&ping_json()).unwrap(),
    )
    .unwrap();
    let bytes = encoder.finish().unwrap();
    refused_with(&bytes, &["damaged or is not"]);
}

#[test]
fn encode_refuses_a_payload_that_decode_would_refuse_for_size() {
    let mut payload = common::ping_payload();
    payload.flows[0].nodes[1].settings.insert(
        "content".to_owned(),
        Value::String("a".repeat(MAX_DECOMPRESSED_BYTES)),
    );
    assert!(matches!(
        payload.encode(),
        Err(PayloadError::TooLarge { .. })
    ));
}

#[test]
fn deeply_nested_settings_are_refused_not_a_stack_overflow() {
    let nested = |depth: usize| {
        let mut value = Value::Null;
        for _ in 0..depth {
            value = Value::Array(vec![value]);
        }
        value
    };
    // Within the limit.
    let mut value = ping_json();
    value["flows"][0]["nodes"][1]["settings"]["content"] = nested(100);
    assert!(Payload::decode(&pack(&value)).is_ok());

    // Beyond it.
    let mut value = ping_json();
    value["flows"][0]["nodes"][1]["settings"]["content"] = nested(200);
    refused_with(&pack(&value), &["depth"]);
}

#[test]
fn a_million_nested_arrays_are_refused() {
    // `0x91` opens an array of one element. The content is 1 MB and compresses to a few
    // bytes, far under the limits, so only the depth limit stops it.
    let mut content = vec![0x82, 0xa7];
    content.extend_from_slice(b"version");
    content.push(0x01);
    content.push(0xa5);
    content.extend_from_slice(b"flows");
    content.extend(std::iter::repeat_n(0x91, 1_000_000));
    content.push(0xc0);
    refused(&zstd_of(&content));
}

mod properties {
    use super::*;
    use graph::{
        CommandDef, EventRoute, Expression, Output, PayloadFlow, PayloadNode, Requirements,
    };
    use proptest::prelude::*;
    use serde_json::Map;

    fn word() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,12}"
    }

    fn json_value() -> impl Strategy<Value = Value> {
        let leaf = prop_oneof![
            Just(Value::Null),
            any::<bool>().prop_map(Value::Bool),
            any::<i64>().prop_map(Value::from),
            any::<u64>().prop_map(Value::from),
            any::<f64>().prop_filter_map("finite", |f| serde_json::Number::from_f64(f)
                .map(Value::Number)),
            ".{0,20}".prop_map(Value::String),
        ];
        leaf.prop_recursive(3, 24, 4, |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..4).prop_map(Value::Array),
                prop::collection::btree_map(".{0,6}", inner, 0..4)
                    .prop_map(|m| Value::Object(m.into_iter().collect())),
            ]
        })
    }

    fn settings() -> impl Strategy<Value = Map<String, Value>> {
        prop::collection::btree_map(".{0,6}", json_value(), 0..4)
            .prop_map(|m| m.into_iter().collect())
    }

    fn node(nodes: usize) -> impl Strategy<Value = PayloadNode> {
        (
            "[A-Za-z0-9_-]{1,8}",
            word(),
            word(),
            any::<u32>(),
            settings(),
            prop::collection::vec((".{0,8}", ".{0,12}"), 0..3),
            prop::collection::vec((word(), prop::collection::vec(0..nodes, 0..3)), 0..3),
        )
            .prop_map(
                |(id, alias, kind, type_version, settings, expressions, next)| PayloadNode {
                    id: id.try_into().unwrap(),
                    alias: alias.try_into().unwrap(),
                    kind,
                    type_version,
                    settings,
                    expressions: expressions
                        .into_iter()
                        .map(|(path, source)| Expression { path, source })
                        .collect(),
                    next: next
                        .into_iter()
                        .map(|(port, to)| Output {
                            port: port.try_into().unwrap(),
                            to: to.into_iter().map(|i| u32::try_from(i).unwrap()).collect(),
                        })
                        .collect(),
                },
            )
    }

    fn flow() -> impl Strategy<Value = PayloadFlow> {
        (1_usize..5).prop_flat_map(|nodes| {
            (
                "[a-z0-9][a-z0-9_-]{0,8}",
                0..nodes,
                prop::collection::vec(node(nodes), nodes),
            )
                .prop_map(|(name, trigger, nodes)| PayloadFlow {
                    name: name.try_into().unwrap(),
                    trigger: u32::try_from(trigger).unwrap(),
                    nodes,
                })
        })
    }

    fn payload() -> impl Strategy<Value = Payload> {
        (1_usize..4).prop_flat_map(|flows| {
            (
                ".{0,10}",
                prop::collection::vec(flow(), flows),
                prop::collection::vec((".{0,8}", prop::collection::vec(0..flows, 0..3)), 0..3),
                prop::collection::vec((".{0,8}", 0..flows, ".{0,8}", settings()), 0..3),
                prop::collection::vec(".{0,8}", 0..3),
            )
                .prop_map(|(app_version, flows, events, commands, strings)| {
                    let mut payload = Payload::new(app_version);
                    payload.flows = flows;
                    payload.events = events
                        .into_iter()
                        .map(|(event, flows)| EventRoute {
                            event,
                            flows: flows
                                .into_iter()
                                .map(|i| u32::try_from(i).unwrap())
                                .collect(),
                        })
                        .collect();
                    payload.commands = commands
                        .into_iter()
                        .map(|(name, flow, hash, definition)| CommandDef {
                            name,
                            flow: u32::try_from(flow).unwrap(),
                            hash,
                            definition,
                        })
                        .collect();
                    payload.requirements = Requirements {
                        intents: strings.clone(),
                        cache: strings.clone(),
                        assets: strings,
                    };
                    payload
                })
        })
    }

    proptest! {
        #[test]
        fn a_generated_payload_round_trips(payload in payload()) {
            let bytes = payload.encode().unwrap();
            prop_assert_eq!(&Payload::decode(&bytes).unwrap(), &payload);
            prop_assert_eq!(&bytes, &payload.encode().unwrap());
        }

        #[test]
        fn arbitrary_bytes_never_panic(bytes in prop::collection::vec(any::<u8>(), 0..512)) {
            let _ = Payload::decode(&bytes);
            let _ = Payload::decode(&zstd_of(&bytes));
        }

        #[test]
        fn damage_is_refused_or_harmless(
            payload in payload(),
            position in any::<prop::sample::Index>(),
            flip in 1_u8..=255,
        ) {
            let mut bytes = payload.encode().unwrap();
            let at = position.index(bytes.len());
            bytes[at] ^= flip;
            if let Ok(found) = Payload::decode(&bytes) {
                prop_assert_eq!(found, payload);
            }
        }
    }
}
