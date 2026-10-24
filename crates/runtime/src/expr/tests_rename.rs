//! Renaming the reads of `steps.<alias>` (`ExpressionEngine::rename_step`).

use proptest::prelude::*;

use super::*;

const REFUSED_READ: ExprError =
    ExprError::Unsupported("a read of a step that cannot be rewritten with certainty");

fn rename(source: &str, from: &str, to: &str) -> Result<Option<String>, ExprError> {
    CelEngine::new().rename_step(source, from, to)
}

fn renamed(source: &str) -> String {
    rename(source, "old", "fresh")
        .expect("it rewrites")
        .expect("something changed")
}

fn unchanged(source: &str) {
    assert_eq!(rename(source, "old", "fresh"), Ok(None), "{source}");
}

#[test]
fn a_read_of_the_step_is_rewritten_wherever_it_is() {
    assert_eq!(
        renamed("steps.old.message_id == '1'"),
        "steps.fresh.message_id == '1'"
    );
    assert_eq!(
        renamed("steps . old . x > 1 && has(steps.old.y)"),
        "steps . fresh . x > 1 && has(steps.fresh.y)"
    );
    assert_eq!(renamed("steps['old'].x"), "steps['fresh'].x");
    assert_eq!(renamed("steps[\"old\"].x"), "steps[\"fresh\"].x");
    assert_eq!(
        renamed("steps.old.a + steps.old.b + steps.other.c"),
        "steps.fresh.a + steps.fresh.b + steps.other.c"
    );
    assert_eq!(
        renamed("event.member.roles.exists(r, r == steps.old.role)"),
        "event.member.roles.exists(r, r == steps.fresh.role)"
    );
    assert_eq!(
        renamed("steps.old.x // steps.old.y"),
        "steps.fresh.x // steps.old.y"
    );
}

#[test]
fn what_only_looks_like_a_read_is_left_alone() {
    unchanged("'steps.old.x' == event.user.id");
    unchanged("\"steps.old\" in event.member.roles");
    unchanged("r'steps.old.x' == event.user.id");
    unchanged("event.options.steps.old == 1");
    unchanged("steps.older.x == 1");
    unchanged("steps.other.old == 1");
    unchanged("steps['older'].x == 1");
    unchanged("event.user.id == 'steps[\\'old\\']'");
    unchanged("event.options.old == 1");
    unchanged("[1].exists(old, old > 0)");
    unchanged("vars.bot.old == 1");
}

#[test]
fn text_around_a_read_is_not_touched() {
    assert_eq!(
        renamed("steps.old.x == 'steps.old.x' && steps.old.y"),
        "steps.fresh.x == 'steps.old.x' && steps.fresh.y"
    );
}

#[test]
fn a_macro_variable_called_steps_is_refused_not_guessed() {
    // `steps` is a macro variable here, so `steps.old` is not a read of a step.
    for source in [
        "[1].exists(steps, steps.old == 1)",
        "[1].exists(steps, steps.old == 1) && steps.old.x",
    ] {
        assert_eq!(
            rename(source, "old", "fresh"),
            Err(REFUSED_READ),
            "{source}"
        );
    }
}

#[test]
fn offsets_in_text_with_other_characters_are_right() {
    assert_eq!(
        renamed("event.user.name == 'ñandú ✓' && steps.old.x == 'é'"),
        "event.user.name == 'ñandú ✓' && steps.fresh.x == 'é'"
    );
}

#[test]
fn the_new_alias_must_be_an_alias() {
    for bad in [
        "",
        "Fresh",
        "a-b",
        "1a",
        "a b",
        "a.b",
        "a'b",
        &"a".repeat(65),
    ] {
        assert!(rename("steps.old.x", "old", bad).is_err(), "{bad:?}");
    }
}

#[test]
fn the_result_must_still_be_an_expression() {
    // A longer alias can push a source over the limit; the source stays as it was.
    let filler = "1".repeat(1900);
    let source = format!("steps.old.x == {filler}");
    let long = "a".repeat(64);
    assert!(rename(&source, "old", &long).is_err());
    assert!(rename("", "old", "fresh").is_err());
    assert!(rename("steps.old.", "old", "fresh").is_err());
}

#[test]
fn renaming_to_the_same_alias_changes_nothing() {
    assert_eq!(rename("steps.old.x", "old", "old"), Ok(None));
}

#[test]
fn a_template_is_rewritten_inside_its_segments_only() {
    let engine = CelEngine::new();
    let rewrite = |source: &str| rename_step_in_template(&engine, source, "old", "fresh");
    assert_eq!(
        rewrite("steps.old.x is {{ steps.old.message_id }} and {{ steps.keep.id }}"),
        Ok(Some(
            "steps.old.x is {{ steps.fresh.message_id }} and {{ steps.keep.id }}".to_owned()
        ))
    );
    assert_eq!(rewrite("no segments steps.old.x"), Ok(None));
    assert_eq!(
        rewrite("{{ '}}' + steps.old.x }}!"),
        Ok(Some("{{ '}}' + steps.fresh.x }}!".to_owned()))
    );
    assert_eq!(rewrite("{{ '{{' }} steps.old"), Ok(None));
    assert!(rewrite("{{ steps.old.x").is_err());
    assert!(rewrite("{{ }}").is_err());
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// Whatever the text, renaming never panics, and what it returns compiles and reads
    /// the new alias where the old one was read.
    #[test]
    fn renaming_arbitrary_text_never_panics(source in ".{0,200}") {
        let engine = CelEngine::new();
        if let Ok(Some(new)) = engine.rename_step(&source, "old", "fresh") {
            prop_assert!(engine.compile(&new).is_ok());
        }
    }

    /// Reads put together from parts are all rewritten, and only those.
    #[test]
    fn built_expressions_are_rewritten_exactly(
        parts in proptest::collection::vec(
            prop_oneof![
                Just("steps.old.x"),
                Just("steps.keep.x"),
                Just("steps['old'].y"),
                Just("event.user.id"),
                Just("'steps.old.x'"),
                Just("1"),
            ],
            1..8,
        ),
        join in prop_oneof![Just(" == "), Just(" + "), Just(" && "), Just(" in ")],
    ) {
        let source = parts.join(join);
        let engine = CelEngine::new();
        let expected = source
            .replace("steps.old.x", "steps.fresh.x")
            .replace("steps['old'].y", "steps['fresh'].y")
            // The text literal is not a read.
            .replace("'steps.fresh.x'", "'steps.old.x'");
        match engine.rename_step(&source, "old", "fresh") {
            Ok(Some(new)) => prop_assert_eq!(new, expected),
            Ok(None) => prop_assert_eq!(source, expected),
            Err(_) => prop_assert!(engine.compile(&source).is_err()),
        }
    }
}
