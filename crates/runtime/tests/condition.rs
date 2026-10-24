//! The model of the condition builder: writing a condition as CEL and reading one back.
#![allow(clippy::unwrap_used, clippy::panic)]

use proptest::prelude::*;
use runtime::condition::{
    Compare, Condition, ConditionError, Join, MAX_ROWS, Operand, Row, TextTest,
};
use runtime::expr::{CelEngine, ExpressionEngine, Value};

fn engine() -> CelEngine {
    CelEngine::new()
}

fn name(parts: &[&str]) -> Operand {
    Operand::Name(parts.iter().map(|p| (*p).to_owned()).collect())
}

fn text(value: &str) -> Operand {
    Operand::Text(value.to_owned())
}

fn compare(left: Operand, op: Compare, right: Operand) -> Row {
    Row::Compare { left, op, right }
}

fn read(source: &str) -> Option<Condition> {
    Condition::from_source(&engine(), source).unwrap_or_else(|e| panic!("{source}: {e}"))
}

fn write(condition: &Condition) -> String {
    condition
        .to_source(&engine())
        .unwrap_or_else(|e| panic!("{condition:?}: {e}"))
}

#[test]
fn the_conditions_of_the_reference_bots_are_read_and_written_back() {
    for source in [
        "'KICK_MEMBERS' in event.member.permissions",
        "'100' in event.member.roles",
        "!('999' in event.member.roles)",
        "event.options.target != event.user.id",
        "event.options.duration >= 1 && event.options.duration <= 40320",
        "event.options.ratio < 0.75",
        "event.options.reason.startsWith(\"spam\")",
        "event.options.reason.endsWith(\"spam\") || has(event.options.extra)",
        "event.guild.id == \"1\" && vars.bot.name != \"\"",
        "vars.server.member_count < 1000",
        "!has(event.options.reason)",
        "!event.options.reason.contains(\"spam\")",
    ] {
        let condition = read(source).unwrap_or_else(|| panic!("not read: {source}"));
        let again = read(&write(&condition)).expect("what is written is read");
        assert_eq!(condition, again, "{source}");
    }
}

#[test]
fn a_read_condition_has_the_expected_rows() {
    let condition = read("event.options.duration >= 1 && 'x' in event.member.roles").unwrap();
    assert_eq!(condition.join, Join::All);
    assert_eq!(
        condition.rows,
        [
            compare(
                name(&["event", "options", "duration"]),
                Compare::Ge,
                Operand::Integer(1)
            ),
            Row::Member {
                negated: false,
                item: text("x"),
                list: name(&["event", "member", "roles"]),
            },
        ]
    );
    let any = read("true == true || false == true || 1 < 2").unwrap();
    assert_eq!(any.join, Join::Any);
    assert_eq!(any.rows.len(), 3);
}

#[test]
fn what_has_another_shape_is_not_read() {
    for source in [
        "event.user.id",
        "!event.user.is_bot",
        "true",
        "event.a.b == 1 && (event.c.d == 2 || event.e.f == 3)",
        "(event.a.b == 1 || event.c.d == 2) && event.e.f == 3",
        "!(event.a.b == 1)",
        "!(event.a.b < 1)",
        "size(event.member.roles) > 1",
        "event.member.roles.exists(r, r == '1')",
        "event.a.b + 1 == 2",
        "event.a.b == 1u",
        "event.a.b == [1, 2]",
        "event.a.b == 9007199254740993",
        "event.a.b == b'x'",
        "event.a.b ? true : false",
        "event == 1",
    ] {
        assert_eq!(read(source), None, "{source}");
    }
    let nine = ["event.a.b == 1"; MAX_ROWS + 1].join(" && ");
    assert_eq!(read(&nine), None);
    let eight = ["event.a.b == 1"; MAX_ROWS].join(" && ");
    assert_eq!(read(&eight).map(|c| c.rows.len()), Some(MAX_ROWS));
}

#[test]
fn an_expression_that_does_not_compile_is_an_error() {
    for source in [
        "",
        "a ==",
        "unknown.x == 1",
        "matches(event.a.b, 'x') && true",
    ] {
        assert!(
            Condition::from_source(&engine(), source).is_err(),
            "{source}"
        );
    }
}

#[test]
fn text_is_data_whatever_it_holds() {
    let hostile = [
        "a\" || true || \"",
        "'; event.x.y == 1 //",
        "\\",
        "\\\"",
        "line\nbreak\r\ttab\u{0}nul\u{7f}",
        "{{ steps.a.b }}",
        "ñandú ✓ 😀",
        "\u{2028}\u{85}",
    ];
    for value in hostile {
        let condition = Condition {
            join: Join::All,
            rows: vec![compare(
                name(&["event", "user", "id"]),
                Compare::Eq,
                text(value),
            )],
        };
        let source = write(&condition);
        assert_eq!(read(&source), Some(condition), "{value:?} -> {source}");

        // And evaluated, the literal is the text and nothing else.
        let compiled = engine().compile(&source).expect("it compiles");
        let scope = runtime::expr::Scope::new(
            serde_json::json!({ "user": { "id": value } }),
            serde_json::json!({}),
            serde_json::json!({}),
            None,
        )
        .expect("a small scope");
        assert_eq!(
            compiled.evaluate(&scope),
            Ok(Value::Bool(true)),
            "{value:?}"
        );
    }
}

#[test]
fn names_that_are_not_identifiers_are_written_with_brackets() {
    let condition = Condition {
        join: Join::All,
        rows: vec![compare(
            name(&["event", "options", "mi-opción"]),
            Compare::Eq,
            Operand::Integer(1),
        )],
    };
    let source = write(&condition);
    assert_eq!(source, r#"event.options["mi-opción"] == 1"#);
    assert_eq!(read(&source), Some(condition));
}

#[test]
fn the_presence_of_a_field_needs_a_field_name() {
    let present = |parts: &[&str]| Condition {
        join: Join::All,
        rows: vec![Row::Present {
            negated: false,
            name: parts.iter().map(|p| (*p).to_owned()).collect(),
        }],
    };
    assert_eq!(
        write(&present(&["event", "options", "reason"])),
        "has(event.options.reason)"
    );
    assert_eq!(
        present(&["event", "options", "mi-opción"]).to_source(&engine()),
        Err(ConditionError::NotExpressible)
    );
    assert_eq!(
        present(&["nowhere", "x"]).to_source(&engine()),
        Err(ConditionError::BadName)
    );
}

#[test]
fn what_cannot_be_written_is_an_error() {
    let one = |row: Row| Condition {
        join: Join::All,
        rows: vec![row],
    };
    let ok = compare(name(&["event", "a", "b"]), Compare::Eq, Operand::Integer(1));
    let engine = engine();

    assert_eq!(
        Condition {
            join: Join::All,
            rows: vec![]
        }
        .to_source(&engine),
        Err(ConditionError::NoRows)
    );
    assert_eq!(
        Condition {
            join: Join::Any,
            rows: vec![ok.clone(); MAX_ROWS + 1]
        }
        .to_source(&engine),
        Err(ConditionError::TooManyRows)
    );
    for bad_name in [
        vec![],
        vec!["event".to_owned()],
        vec!["event".to_owned(), String::new()],
        vec!["other".to_owned(), "x".to_owned()],
    ] {
        let row = compare(Operand::Name(bad_name), Compare::Eq, Operand::Integer(1));
        assert_eq!(one(row).to_source(&engine), Err(ConditionError::BadName));
    }
    for bad_number in [
        Operand::Integer(1 << 53),
        Operand::Integer(i64::MIN),
        Operand::Integer(i64::MAX),
        Operand::Decimal(f64::NAN),
        Operand::Decimal(f64::INFINITY),
        Operand::Decimal(f64::NEG_INFINITY),
    ] {
        let row = compare(name(&["event", "a", "b"]), Compare::Lt, bad_number);
        assert_eq!(one(row).to_source(&engine), Err(ConditionError::BadNumber));
    }
    let long = compare(
        name(&["event", "a", "b"]),
        Compare::Eq,
        text(&"x".repeat(3000)),
    );
    assert_eq!(one(long).to_source(&engine), Err(ConditionError::TooLong));
    let receiver = Row::Text {
        negated: false,
        left: Operand::Integer(-1),
        op: TextTest::Contains,
        right: text("x"),
    };
    assert_eq!(
        one(receiver).to_source(&engine),
        Err(ConditionError::BadReceiver)
    );
    // The largest numbers it accepts.
    let edge = compare(
        Operand::Integer(-((1 << 53) - 1)),
        Compare::Le,
        Operand::Decimal(-1.5e300),
    );
    assert_eq!(read(&write(&one(edge.clone()))), Some(one(edge)));
}

#[test]
fn the_error_messages_say_nothing_about_the_text_typed() {
    let secret = "hunter2-token";
    let bad = Condition {
        join: Join::All,
        rows: vec![compare(
            Operand::Name(vec![secret.to_owned()]),
            Compare::Eq,
            text(secret),
        )],
    };
    let message = bad.to_source(&engine()).unwrap_err().to_string();
    assert!(!message.contains(secret), "{message}");
}

// --- properties -------------------------------------------------------------------------------

fn arbitrary_name() -> impl Strategy<Value = Operand> {
    prop_oneof![
        Just(name(&["event", "user", "id"])),
        Just(name(&["event", "member", "roles"])),
        Just(name(&["event", "options", "reason"])),
        Just(name(&["event", "options", "mi-opción"])),
        Just(name(&["event", "options", "in"])),
        Just(name(&["steps", "reply", "message_id"])),
        Just(name(&["vars", "server", "count"])),
        Just(name(&["error", "kind"])),
    ]
}

fn arbitrary_operand() -> impl Strategy<Value = Operand> {
    prop_oneof![
        arbitrary_name(),
        any::<String>().prop_map(Operand::Text),
        (-(1i64 << 53) + 1..(1i64 << 53)).prop_map(Operand::Integer),
        any::<f64>()
            .prop_filter("finite", |n| n.is_finite())
            .prop_map(Operand::Decimal),
        any::<bool>().prop_map(Operand::Boolean),
    ]
}

fn arbitrary_row() -> impl Strategy<Value = Row> {
    let compare_op = prop_oneof![
        Just(Compare::Eq),
        Just(Compare::Ne),
        Just(Compare::Lt),
        Just(Compare::Le),
        Just(Compare::Gt),
        Just(Compare::Ge),
    ];
    let text_op = prop_oneof![
        Just(TextTest::Contains),
        Just(TextTest::StartsWith),
        Just(TextTest::EndsWith),
    ];
    let receiver = prop_oneof![arbitrary_name(), any::<String>().prop_map(Operand::Text)];
    prop_oneof![
        (arbitrary_operand(), compare_op, arbitrary_operand())
            .prop_map(|(left, op, right)| Row::Compare { left, op, right }),
        (any::<bool>(), receiver, text_op, arbitrary_operand()).prop_map(
            |(negated, left, op, right)| Row::Text {
                negated,
                left,
                op,
                right
            }
        ),
        (any::<bool>(), arbitrary_operand(), arbitrary_name()).prop_map(|(negated, item, list)| {
            Row::Member {
                negated,
                item,
                list,
            }
        }),
        (any::<bool>(), arbitrary_name()).prop_map(|(negated, name)| {
            let Operand::Name(name) = name else {
                unreachable!()
            };
            Row::Present { negated, name }
        }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]

    /// Every condition that can be written compiles, and reads back as the same condition.
    #[test]
    fn writing_and_reading_are_inverse(
        rows in proptest::collection::vec(arbitrary_row(), 1..=MAX_ROWS),
        any_join in any::<bool>(),
    ) {
        let join = if any_join && rows.len() > 1 { Join::Any } else { Join::All };
        let condition = Condition { join, rows };
        let engine = engine();
        match condition.to_source(&engine) {
            Ok(source) => {
                prop_assert!(engine.compile(&source).is_ok());
                prop_assert_eq!(Condition::from_source(&engine, &source), Ok(Some(condition)));
            }
            // Too long, or a presence test on a name that is not a field name.
            Err(ConditionError::TooLong | ConditionError::NotExpressible) => {}
            Err(other) => prop_assert!(false, "unexpected {other}"),
        }
    }

    /// Reading arbitrary text never panics, and what is read can be written.
    #[test]
    fn reading_arbitrary_text_never_panics(source in ".{0,300}") {
        let engine = engine();
        if let Ok(Some(condition)) = Condition::from_source(&engine, &source) {
            prop_assert!(condition.to_source(&engine).is_ok() || source.len() > 100);
        }
    }
}
