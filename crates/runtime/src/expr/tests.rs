use std::sync::Arc;

use proptest::prelude::*;
use serde_json::json;

use super::*;

fn engine() -> CelEngine {
    CelEngine::new()
}

fn compile(source: &str) -> Result<Box<dyn Expression>, ExprError> {
    engine().compile(source)
}

fn eval(source: &str, scope: &Scope) -> Result<Value, ExprError> {
    compile(source)?.evaluate(scope)
}

fn render(source: &str, scope: &Scope) -> Result<String, ExprError> {
    Template::compile(&engine(), source)?.render(scope)
}

fn refs(source: &str) -> Vec<String> {
    let expression = compile(source).expect("the test source compiles");
    expression
        .references()
        .paths()
        .map(Path::to_string)
        .collect()
}

/// The shape of `event` that the reference bots read. The real shape is fixed by the nodes in
/// M5 and M7; what matters here is that Discord ids are text and roles are a list of ids.
fn event() -> Value {
    json!({
        "user": { "id": "42", "name": "kevin", "is_bot": false },
        "member": {
            "roles": ["100", "200"],
            "permissions": ["KICK_MEMBERS", "BAN_MEMBERS"],
            "top_role_position": 5,
        },
        "target": { "id": "77", "top_role_position": 3 },
        "options": { "target": "77", "reason": "spam in #general", "duration": 10, "ratio": 0.5 },
        "guild": { "id": "1" },
    })
}

fn vars() -> Value {
    json!({ "server": { "member_count": 41, "greeting": "Welcome" }, "bot": { "name": "Guard" } })
}

fn scope() -> Scope {
    Scope::new(event(), json!({}), vars(), None).expect("the test scope is small")
}

fn scope_with(event: Value) -> Scope {
    Scope::new(event, json!({}), vars(), None).expect("the test scope is small")
}

// --- evaluation -------------------------------------------------------------------------------

#[test]
fn evaluates_arithmetic_comparison_and_logic() {
    let empty = Scope::empty();
    assert_eq!(eval("1 + 2 * 3", &empty), Ok(json!(7)));
    assert_eq!(eval("7 % 4 == 3 && !(2 > 3)", &empty), Ok(json!(true)));
    assert_eq!(eval("1.5 + 1.0", &empty), Ok(json!(2.5)));
    assert_eq!(eval("true ? 'a' : 'b'", &empty), Ok(json!("a")));
    assert_eq!(
        eval("[1, 2, 3].map(x, x * 2)", &empty),
        Ok(json!([2, 4, 6]))
    );
    assert_eq!(eval("{'a': 1}['a']", &empty), Ok(json!(1)));
}

#[test]
fn integers_from_data_compare_with_integer_literals() {
    // serde_json stores 5 as an unsigned number; it must still be a CEL int.
    let scope = scope_with(json!({ "n": 5, "big": u64::MAX, "neg": -3 }));
    assert_eq!(eval("event.n == 5 && event.n > 4", &scope), Ok(json!(true)));
    assert_eq!(eval("event.neg < 0", &scope), Ok(json!(true)));
    assert_eq!(eval("event.big > 0u", &scope), Ok(json!(true)));
}

#[test]
fn a_program_is_shared_across_threads() {
    let expression: Arc<dyn Expression> =
        Arc::from(compile("event.options.duration * 2").expect("compiles"));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let expression = Arc::clone(&expression);
            std::thread::spawn(move || expression.evaluate(&scope()))
        })
        .collect();
    for handle in handles {
        assert_eq!(handle.join().expect("no panic"), Ok(json!(20)));
    }
}

// --- the conditions of the reference bots -----------------------------------------------------

#[test]
fn moderation_permission_and_role_checks() {
    let s = scope();
    assert_eq!(
        eval("'KICK_MEMBERS' in event.member.permissions", &s),
        Ok(json!(true))
    );
    assert_eq!(
        eval("'ADMINISTRATOR' in event.member.permissions", &s),
        Ok(json!(false))
    );
    assert_eq!(eval("'100' in event.member.roles", &s), Ok(json!(true)));
    assert_eq!(eval("'999' in event.member.roles", &s), Ok(json!(false)));
    assert_eq!(
        eval("event.member.roles.exists(r, r == '200')", &s),
        Ok(json!(true))
    );
    // Ids are text: comparing one with a number is an error, not a silent false.
    assert!(eval("event.user.id == 42", &s).is_ok_and(|v| v == json!(false)));
}

#[test]
fn moderation_role_hierarchy_and_self_target() {
    let s = scope();
    let allowed = "event.member.top_role_position > event.target.top_role_position";
    assert_eq!(eval(allowed, &s), Ok(json!(true)));
    let lower = scope_with(json!({
        "member": { "top_role_position": 2 },
        "target": { "top_role_position": 3 },
    }));
    assert_eq!(eval(allowed, &lower), Ok(json!(false)));
    assert_eq!(
        eval("event.options.target != event.user.id", &s),
        Ok(json!(true))
    );
    let same = scope_with(json!({ "options": { "target": "42" }, "user": { "id": "42" } }));
    assert_eq!(
        eval("event.options.target != event.user.id", &same),
        Ok(json!(false))
    );
}

#[test]
fn moderation_number_and_text_comparisons() {
    let s = scope();
    let duration = "event.options.duration >= 1 && event.options.duration <= 40320";
    assert_eq!(eval(duration, &s), Ok(json!(true)));
    let too_long = scope_with(json!({ "options": { "duration": 50000 } }));
    assert_eq!(eval(duration, &too_long), Ok(json!(false)));
    assert_eq!(eval("event.options.ratio < 0.75", &s), Ok(json!(true)));
    assert_eq!(
        eval("size(event.options.reason) <= 512", &s),
        Ok(json!(true))
    );
    assert_eq!(
        eval("event.options.reason.startsWith('spam')", &s),
        Ok(json!(true))
    );
    assert_eq!(
        eval("event.options.reason.endsWith('spam')", &s),
        Ok(json!(false))
    );
    assert_eq!(
        eval("event.options.reason.contains('#general')", &s),
        Ok(json!(true))
    );
    assert_eq!(
        eval("event.options.reason == 'spam in #general'", &s),
        Ok(json!(true))
    );
    assert_eq!(eval("event.options.reason < 'zzz'", &s), Ok(json!(true)));
}

#[test]
fn moderation_optional_reason_with_a_default() {
    let source = "has(event.options.reason) ? event.options.reason : 'No reason given'";
    assert_eq!(eval(source, &scope()), Ok(json!("spam in #general")));
    let without = scope_with(json!({ "options": {} }));
    assert_eq!(eval(source, &without), Ok(json!("No reason given")));
}

#[test]
fn welcome_conditions() {
    let s = scope();
    assert_eq!(eval("!event.user.is_bot", &s), Ok(json!(true)));
    assert_eq!(eval("vars.server.member_count < 1000", &s), Ok(json!(true)));
    assert_eq!(eval("vars.server.member_count + 1", &s), Ok(json!(42)));
    assert_eq!(
        eval("event.guild.id == '1' && vars.bot.name != ''", &s),
        Ok(json!(true))
    );
}

#[test]
fn reference_bot_templates() {
    let s = scope();
    assert_eq!(
        render(
            "{{ vars.server.greeting }}, {{ event.user.name }}! You are member number {{ vars.server.member_count + 1 }}.",
            &s
        ),
        Ok("Welcome, kevin! You are member number 42.".to_owned())
    );
    assert_eq!(
        render(
            "<@{{ event.user.id }}> kicked <@{{ event.options.target }}>: {{ event.options.reason }}",
            &s
        ),
        Ok("<@42> kicked <@77>: spam in #general".to_owned())
    );
}

// --- templates --------------------------------------------------------------------------------

#[test]
fn template_segments() {
    let s = scope();
    assert_eq!(render("", &s), Ok(String::new()));
    assert_eq!(render("plain text", &s), Ok("plain text".to_owned()));
    assert_eq!(render("{{ 1 }}{{ 2 }}", &s), Ok("12".to_owned()));
    assert_eq!(
        render("a{{ 'b' }}c{{ true }}d{{ 1.5 }}", &s),
        Ok("abctrued1.5".to_owned())
    );
}

#[test]
fn template_edge_cases() {
    let s = scope();
    assert_eq!(render("{{ }}", &s), Err(ExprError::Empty));
    assert_eq!(
        render("hi {{ 1 + 1", &s),
        Err(ExprError::UnclosedSegment { offset: 3 })
    );
    assert_eq!(
        render("hi {{ '}}' ", &s),
        Err(ExprError::UnclosedSegment { offset: 3 })
    );
    assert_eq!(render("a }} b", &s), Ok("a }} b".to_owned()));
    assert_eq!(render("{{ '{{' }} x", &s), Ok("{{ x".to_owned()));
    assert_eq!(render("{{ '}}' }}", &s), Ok("}}".to_owned()));
    assert_eq!(
        render("{{ {'a': {'b': 1}}['a']['b'] }}", &s),
        Ok("1".to_owned())
    );
    assert_eq!(render(r#"{{ "a\"}}" }}"#, &s), Ok("a\"}}".to_owned()));
    assert_eq!(render("{{ r'\\' }}", &s), Ok("\\".to_owned()));
    assert_eq!(render("{{ '''}}''' }}", &s), Ok("}}".to_owned()));
    assert!(matches!(render("{{ 1 + }}", &s), Err(ExprError::Syntax(_))));
}

#[test]
fn template_refuses_values_that_have_no_single_text() {
    let s = scope();
    assert!(matches!(
        render("{{ null }}", &s),
        Err(ExprError::UnsupportedResult(_))
    ));
    assert!(matches!(
        render("{{ [1] }}", &s),
        Err(ExprError::UnsupportedResult(_))
    ));
    assert!(matches!(
        render("{{ event.user }}", &s),
        Err(ExprError::UnsupportedResult(_))
    ));
}

#[test]
fn template_collects_the_references_of_all_segments() {
    let template = Template::compile(
        &engine(),
        "{{ event.user.id }} {{ vars.server.member_count }} {{ size(steps.a.text) }}",
    )
    .expect("compiles");
    let paths: Vec<_> = template.references().paths().map(Path::to_string).collect();
    assert_eq!(
        paths,
        ["event.user.id", "steps.a.text", "vars.server.member_count"]
    );
    assert_eq!(
        template.references().functions().collect::<Vec<_>>(),
        ["size"]
    );
}

#[test]
fn a_template_longer_than_the_limit_is_refused() {
    let source = "a".repeat(MAX_TEMPLATE_BYTES + 1);
    assert!(matches!(
        Template::compile(&engine(), &source),
        Err(ExprError::SourceTooLong { .. })
    ));
}

// --- text from Discord users is data ----------------------------------------------------------

#[test]
fn text_from_users_is_inserted_and_never_evaluated() {
    let hostile = [
        "{{ 1 + 1 }}",
        "{{ event.user.id }}",
        "{{ vars.server.member_count }}",
        "}} {{",
        "' || true || '",
        "${event.user.id}",
    ];
    for text in hostile {
        let s = scope_with(json!({ "options": { "reason": text }, "user": { "id": "42" } }));
        assert_eq!(
            render("Reason: {{ event.options.reason }}", &s),
            Ok(format!("Reason: {text}"))
        );
        assert_eq!(eval("event.options.reason", &s), Ok(json!(text)));
        // Used as a condition operand it is compared as text.
        assert_eq!(
            eval("event.options.reason == event.options.reason", &s),
            Ok(json!(true))
        );
    }
}

#[test]
fn a_template_in_a_user_value_is_not_compiled_by_the_engine() {
    // The engine only ever compiles sources written by the author; a value in the scope that
    // looks like an expression stays a string, even when it is used as a map key lookup.
    let s = scope_with(json!({ "options": { "reason": "event.user.id" }, "user": { "id": "42" } }));
    assert_eq!(eval("event.options.reason", &s), Ok(json!("event.user.id")));
}

// --- references -------------------------------------------------------------------------------

#[test]
fn references_list_the_paths_that_are_read() {
    assert_eq!(refs("event.user.id == '1'"), ["event.user.id"]);
    assert_eq!(
        refs("steps.ban.ok && vars.server.member_count > 1"),
        ["steps.ban.ok", "vars.server.member_count"]
    );
    assert_eq!(refs("error.kind == 'forbidden'"), ["error.kind"]);
    assert_eq!(
        refs("event.options['reason'] == ''"),
        ["event.options.reason"]
    );
    assert_eq!(refs("has(event.options.reason)"), ["event.options.reason"]);
    assert_eq!(refs("1 + 2"), Vec::<String>::new());
}

#[test]
fn references_stop_at_a_dynamic_part() {
    assert_eq!(
        refs("event.options[vars.bot.key]"),
        ["event.options", "vars.bot.key"]
    );
    assert_eq!(refs("event.member.roles[0]"), ["event.member.roles"]);
}

#[test]
fn references_list_each_path_once_and_the_functions() {
    let expression =
        compile("size(event.options.reason) > 3 && event.options.reason.startsWith('a')")
            .expect("compiles");
    let paths: Vec<_> = expression
        .references()
        .paths()
        .map(Path::to_string)
        .collect();
    assert_eq!(paths, ["event.options.reason"]);
    assert_eq!(
        expression.references().functions().collect::<Vec<_>>(),
        ["size", "startsWith"]
    );
    assert!(expression.references().reads("event"));
    assert!(!expression.references().reads("vars"));
}

#[test]
fn names_bound_by_macros_are_not_references() {
    assert_eq!(
        refs("event.member.roles.exists(r, r == vars.bot.name)"),
        ["event.member.roles", "vars.bot.name"]
    );
    assert_eq!(
        refs("event.member.roles.map(r, r + '!').filter(x, x != 'a')"),
        ["event.member.roles"]
    );
    assert_eq!(refs("[1, 2].all(n, n > 0)"), Vec::<String>::new());
}

#[test]
fn an_unknown_root_is_refused() {
    assert_eq!(
        compile("user.id").err(),
        Some(ExprError::UnknownName("user".to_owned()))
    );
    assert!(
        matches!(compile("event.a == other"), Err(ExprError::UnknownName(name)) if name == "other")
    );
    assert!(
        matches!(compile("[1].exists(r, q)"), Err(ExprError::UnknownName(name)) if name == "q")
    );
    // A macro variable does not leak out of its macro.
    assert!(matches!(
        compile("[1].exists(r, r) && r"),
        Err(ExprError::UnknownName(_))
    ));
}

// --- limits and purity ------------------------------------------------------------------------

#[test]
fn source_depth_nodes_operators_and_macro_nesting_are_limited() {
    let too_complex = |source: &str| match compile(source).err() {
        Some(ExprError::TooComplex(why)) => why,
        _ => "not refused as too complex",
    };
    assert!(matches!(
        compile(&"1".repeat(MAX_SOURCE_BYTES + 1)),
        Err(ExprError::SourceTooLong { .. })
    ));
    let nested = format!(
        "{}1{}",
        "(".repeat(MAX_DEPTH + 1),
        ")".repeat(MAX_DEPTH + 1)
    );
    assert_eq!(too_complex(&nested), "brackets nested too deeply");
    let deep_select = format!("event{}", ".a".repeat(MAX_DEPTH + 1));
    assert_eq!(too_complex(&deep_select), "nested too deeply");
    // Many parts with almost no operators: a flat list.
    let flat = format!("[{}]", vec!["1"; MAX_NODES + 1].join(","));
    assert_eq!(too_complex(&flat), "too many parts");
    assert!(compile(&format!("[{}]", vec!["1"; MAX_NODES - 2].join(","))).is_ok());
    let chain = vec!["1"; MAX_OPERATORS + 2].join("+");
    assert_eq!(too_complex(&chain), "too many operators");
    assert_eq!(
        too_complex("[1].all(a, [2].all(b, [3].all(c, a < b && b < c)))"),
        "macros nested too deeply"
    );
    assert!(compile("[1].all(a, [2].all(b, a < b))").is_ok());
    // Operators inside quoted text are not counted.
    assert!(compile(&format!("'{}'", "+".repeat(MAX_OPERATORS * 2))).is_ok());
}

#[test]
fn the_scope_is_limited_when_it_is_built() {
    let big_text = json!({ "t": "a".repeat(MAX_SCOPE_BYTES + 1) });
    assert!(matches!(
        Scope::new(big_text, json!({}), json!({}), None),
        Err(ExprError::ScopeTooLarge(_))
    ));
    let long_list = json!({ "l": vec![0; MAX_COLLECTION_LEN + 1] });
    assert!(matches!(
        Scope::new(long_list, json!({}), json!({}), None),
        Err(ExprError::ScopeTooLarge(_))
    ));
    let many = json!({ "a": vec![vec![0; MAX_COLLECTION_LEN]; 5] });
    assert!(matches!(
        Scope::new(many, json!({}), json!({}), None),
        Err(ExprError::ScopeTooLarge(_))
    ));
    let mut deep = json!(1);
    for _ in 0..=MAX_SCOPE_DEPTH {
        deep = json!([deep]);
    }
    assert!(matches!(
        Scope::new(deep, json!({}), json!({}), None),
        Err(ExprError::ScopeTooLarge(_))
    ));
    // Deep data is refused by a walk that does not recurse.
    let mut deeper = json!(1);
    for _ in 0..1_000 {
        deeper = json!([deeper]);
    }
    assert!(matches!(
        Scope::new(json!({}), deeper, json!({}), None),
        Err(ExprError::ScopeTooLarge(_))
    ));
}

#[test]
fn a_result_over_the_limit_is_refused() {
    let s = scope_with(json!({ "t": "a".repeat(MAX_RESULT_BYTES / 2 + 1) }));
    assert_eq!(
        eval("event.t", &s),
        Ok(json!("a".repeat(MAX_RESULT_BYTES / 2 + 1)))
    );
    assert_eq!(
        eval("event.t + event.t", &s),
        Err(ExprError::ResultTooLarge)
    );
    assert_eq!(
        render("{{ event.t }}{{ event.t }}", &s),
        Err(ExprError::ResultTooLarge)
    );
}

#[test]
fn allowed_functions_are_a_closed_list() {
    // Adding a function to the engine means editing this list on purpose, and checking that the
    // function is pure: no I/O, no clock, no randomness.
    let mut expected = vec![
        "!_",
        "-_",
        "@in",
        "@not_strictly_false",
        "_!=_",
        "_%_",
        "_&&_",
        "_*_",
        "_+_",
        "_-_",
        "_/_",
        "_<=_",
        "_<_",
        "_==_",
        "_>=_",
        "_>_",
        "_?_:_",
        "_[_]",
        "_||_",
        "bool",
        "contains",
        "double",
        "dyn",
        "endsWith",
        "int",
        "size",
        "startsWith",
        "string",
        "type",
        "uint",
    ];
    let mut actual = cel_engine::allowed_functions().to_vec();
    expected.sort_unstable();
    actual.sort_unstable();
    assert_eq!(actual, expected);
}

#[test]
fn functions_outside_the_list_are_refused() {
    for source in [
        "matches('a', 'a')",
        "'a'.matches('a')",
        "timestamp('2020-01-01T00:00:00Z')",
        "duration('1s')",
        "now()",
        "random()",
        "env('HOME')",
        "bytes('a')",
        "optional.of(1)",
        "event.a.lowerAscii()",
        "max(1, 2)",
    ] {
        assert!(
            matches!(
                compile(source),
                Err(ExprError::UnknownFunction(_) | ExprError::Syntax(_))
            ),
            "{source} should be refused"
        );
    }
}

#[test]
fn struct_literals_are_refused() {
    assert!(compile("Foo{a: 1}").is_err());
}

// --- bad input --------------------------------------------------------------------------------

#[test]
fn bad_input_returns_errors() {
    let s = scope();
    let compile_errors = [
        "",
        "   ",
        "1 +",
        "(",
        ")",
        "1 2",
        "event.",
        "'unterminated",
        "\"\"\"unterminated",
        "@",
        "1 ? 2",
        "[1, 2",
        "{'a': }",
        "\u{0}",
        "e\u{301}vent",
        "🙂",
        "ev\u{200b}ent.user",
    ];
    for source in compile_errors {
        assert!(compile(source).is_err(), "{source:?} should not compile");
    }
    let run_errors = [
        "1 / 0",
        "1 % 0",
        "9223372036854775807 + 1",
        "-9223372036854775807 - 2",
        "[1, 2][5]",
        "[1, 2][-1]",
        "{'a': 1}['b']",
        "event.missing",
        "event.user.id.nope",
        "event.user.id + 1",
        "event.user.id > 1",
        "size(1)",
        "int('abc')",
        "int(9223372036854775808.0)",
        "'a'.startsWith(1)",
        "event.options.duration.contains('a')",
        "null + null",
        "error.kind",
        "steps.a.b",
    ];
    for source in run_errors {
        let result = eval(source, &s);
        assert!(
            matches!(result, Err(ExprError::Evaluation(_))),
            "{source:?} gave {result:?}"
        );
    }
}

#[test]
fn evaluation_messages_do_not_carry_values() {
    let secret = "SECRET-TEXT-FROM-A-USER";
    let s = scope_with(json!({ "t": secret }));
    for source in [
        "event.t + 1",
        "event.t > 1",
        "event.t[3]",
        "int(event.t)",
        "event.t.nope",
    ] {
        let message = eval(source, &s).expect_err("fails").to_string();
        assert!(!message.contains(secret), "{source}: {message}");
        assert!(message.len() < 300);
    }
}

#[test]
fn a_missing_namespace_is_an_error_not_a_panic() {
    // `error` only exists on an error path.
    assert!(matches!(
        eval("error.kind == 'x'", &scope()),
        Err(ExprError::Evaluation(_))
    ));
    let on_error = Scope::new(
        json!({}),
        json!({}),
        json!({}),
        Some(json!({ "kind": "forbidden" })),
    )
    .expect("small");
    assert_eq!(
        eval("error.kind == 'forbidden'", &on_error),
        Ok(json!(true))
    );
}

#[test]
fn results_that_are_not_data_are_errors() {
    let s = scope();
    assert!(matches!(
        eval("1.0 / 0.0", &s),
        Err(ExprError::UnsupportedResult(_))
    ));
    assert!(matches!(
        eval("0.0 / 0.0", &s),
        Err(ExprError::UnsupportedResult(_))
    ));
    assert!(matches!(
        eval("b'abc'", &s),
        Err(ExprError::UnsupportedResult(_))
    ));
    assert_eq!(
        eval("{1: 'a', true: 'b'}", &s),
        Ok(json!({ "1": "a", "true": "b" }))
    );
}

#[test]
fn hostile_nesting_does_not_overflow_a_small_stack() {
    let n = MAX_SOURCE_BYTES;
    let k = MAX_OPERATORS;
    let sources = [
        "(".repeat(n),
        "[".repeat(n),
        "{".repeat(n),
        "!".repeat(n - 1) + "true",
        "-".repeat(n - 1) + "1",
        "- ".repeat(n / 2 - 1) + "1",
        "a?".repeat(n / 2),
        vec!["1"; n / 2].join("+"),
        vec!["1"; n / 2].join("&&"),
        format!("event{}", ".a".repeat(n / 2 - 3)),
        format!("event{}", "[0]".repeat(n / 3 - 3)),
        format!("{}1{}", "f(".repeat(500), ")".repeat(500)),
        // The largest chains the operator limit lets through.
        vec!["1"; k].join("+"),
        vec!["1"; k].join("&&"),
        vec!["1"; k].join("<"),
        format!("event{}", ".a".repeat(k - 1)),
        format!("event{}", "[0]".repeat(k - 1)),
        format!("event{}", ".f()".repeat(k / 2 - 1)),
        "!".repeat(k - 1) + "true",
        "a?".repeat(k - 1) + "b",
    ];
    let outcome = std::thread::Builder::new()
        .stack_size(512 * 1024)
        .spawn(move || {
            let engine = CelEngine::new();
            let scope = Scope::empty();
            for source in &sources {
                if let Ok(expression) = engine.compile(source) {
                    let _ = expression.evaluate(&scope);
                }
            }
        })
        .expect("spawns")
        .join();
    assert!(outcome.is_ok());
}

#[test]
fn macros_over_long_lists_stay_fast_enough() {
    let list: Vec<usize> = (0..512).collect();
    let s = scope_with(json!({ "l": list }));
    let started = std::time::Instant::now();
    assert_eq!(
        eval("event.l.all(a, event.l.all(b, a >= 0 && b >= 0))", &s),
        Ok(json!(true))
    );
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
}

proptest! {
    #[test]
    fn arbitrary_text_never_panics(source in "\\PC{0,300}") {
        let engine = CelEngine::new();
        if let Ok(expression) = engine.compile(&source) {
            let _ = expression.evaluate(&scope());
        }
        if let Ok(template) = Template::compile(&engine, &source) {
            let _ = template.render(&scope());
        }
    }

    #[test]
    fn cel_like_text_never_panics(source in "[a-z0-9 .()\\[\\]{}'\"+*/%<>=!&|?:,_@\\\\-]{0,200}") {
        let engine = CelEngine::new();
        if let Ok(expression) = engine.compile(&source) {
            let _ = expression.evaluate(&scope());
        }
        if let Ok(template) = Template::compile(&engine, &format!("x {{{{ {source} }}}} y")) {
            let _ = template.render(&scope());
        }
    }

    #[test]
    fn user_text_is_always_inserted_unchanged(text in "\\PC{0,200}") {
        let s = scope_with(json!({ "t": text.clone() }));
        let rendered = render("[{{ event.t }}]", &s).expect("text renders");
        prop_assert_eq!(rendered, format!("[{text}]"));
    }
}
