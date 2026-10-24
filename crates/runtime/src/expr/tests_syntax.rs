//! What the condition builder sees of an expression (`ExpressionEngine::syntax`).

use super::*;
use Syntax::{Binary as Bin, Boolean, Decimal, Integer, Name, Not, Other, Presence, Text};

fn syntax(source: &str) -> Syntax {
    CelEngine::new()
        .syntax(source)
        .expect("the test source compiles")
}

fn name(parts: &[&str]) -> Box<Syntax> {
    Box::new(Name(parts.iter().map(|p| (*p).to_owned()).collect()))
}

#[test]
fn comparisons_and_literals() {
    assert_eq!(
        syntax("event.options.amount >= 10"),
        Bin(
            Binary::Ge,
            name(&["event", "options", "amount"]),
            Box::new(Integer(10))
        )
    );
    assert_eq!(
        syntax("event.user.id != '42'"),
        Bin(
            Binary::Ne,
            name(&["event", "user", "id"]),
            Box::new(Text("42".into()))
        )
    );
    assert_eq!(
        syntax("vars.bot.rate < -1.5"),
        Bin(
            Binary::Lt,
            name(&["vars", "bot", "rate"]),
            Box::new(Decimal(-1.5))
        )
    );
    assert_eq!(
        syntax("vars.bot.on == true"),
        Bin(
            Binary::Eq,
            name(&["vars", "bot", "on"]),
            Box::new(Boolean(true))
        )
    );
    assert_eq!(syntax("-3"), Integer(-3));
}

#[test]
fn names_in_the_two_spellings_are_the_same_name() {
    assert_eq!(
        syntax("event.options['reason']"),
        *name(&["event", "options", "reason"])
    );
    assert_eq!(
        syntax("event.options['a-b']"),
        *name(&["event", "options", "a-b"])
    );
    assert_eq!(
        syntax("steps['x'].message_id"),
        *name(&["steps", "x", "message_id"])
    );
}

#[test]
fn membership_text_methods_presence_and_not() {
    assert_eq!(
        syntax("'100' in event.member.roles"),
        Bin(
            Binary::In,
            Box::new(Text("100".into())),
            name(&["event", "member", "roles"])
        )
    );
    assert_eq!(
        syntax("event.options.reason.contains('spam')"),
        Syntax::Method(
            Method::Contains,
            name(&["event", "options", "reason"]),
            Box::new(Text("spam".into()))
        )
    );
    assert!(matches!(
        syntax("event.user.name.startsWith('a')"),
        Syntax::Method(Method::StartsWith, _, _)
    ));
    assert!(matches!(
        syntax("event.user.name.endsWith('a')"),
        Syntax::Method(Method::EndsWith, _, _)
    ));
    assert_eq!(
        syntax("has(event.options.reason)"),
        Presence(vec!["event".into(), "options".into(), "reason".into()])
    );
    assert_eq!(
        syntax("!has(event.options.reason)"),
        Not(Box::new(Presence(vec![
            "event".into(),
            "options".into(),
            "reason".into()
        ])))
    );
}

#[test]
fn a_chain_of_and_nests_to_the_left() {
    assert!(matches!(
        syntax("true && false && true"),
        Bin(Binary::And, left, _) if matches!(*left, Bin(Binary::And, _, _))
    ));
}

#[test]
fn what_the_builder_does_not_know_is_other() {
    assert_eq!(syntax("9007199254740993"), Other);
    assert_eq!(syntax("1u"), Other);
    assert_eq!(syntax("[1, 2]"), Other);
    assert_eq!(syntax("size(event.member.roles)"), Other);
    assert_eq!(syntax("b'abc'"), Other);
    assert_eq!(syntax("9223372036854775807"), Other);
    assert_eq!(syntax("event.user.id ? 1 : 2"), Other);
    assert_eq!(syntax("event.member.roles.exists(r, r == '1')"), Other);
}

#[test]
fn syntax_refuses_what_compile_refuses() {
    let engine = CelEngine::new();
    for bad in [
        "",
        "a +",
        "unknown.x == 1",
        "matches(event.user.id, 'a')",
        "event.a.b.c.(",
    ] {
        assert!(engine.syntax(bad).is_err(), "{bad}");
    }
}
