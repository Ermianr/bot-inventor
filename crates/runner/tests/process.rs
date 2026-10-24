//! The runner as a process: its arguments, its exit codes, its output and its signals. Discord
//! is stood in for by a local HTTP server (`BOT_INVENTOR_DISCORD_PROXY`); the gateway is not part
//! of the suite (`docs/DISCORD-TEST.md`).

#![allow(clippy::unwrap_used, clippy::panic)]

use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use runtime::graph::{
    Payload, Variable, VariableName, VariableScope, VariableType, write_container,
};
use serde_json::{Value, json};

mod common;
use common::{FakeDiscord, MARKER, code, never_shows_the_token, sample, stderr, stdout};

const RUNNER: &str = env!("CARGO_BIN_EXE_runner");

/// A folder with a `.env`, a payload and the folders the runner looks in.
struct Bot {
    dir: tempfile::TempDir,
}

impl Bot {
    fn new() -> Self {
        let bot = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        bot.env(&format!("DISCORD_TOKEN={MARKER}\n"));
        fs::copy(sample("ping.payload"), bot.path("payload.bin")).unwrap();
        bot
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn env(&self, text: &str) {
        use std::os::unix::fs::PermissionsExt;
        let path = self.path(".env");
        fs::write(&path, text).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }

    fn payload(&self, edit: impl FnOnce(&mut Payload)) {
        let mut payload = Payload::decode(&fs::read(sample("ping.payload")).unwrap()).unwrap();
        edit(&mut payload);
        fs::write(self.path("payload.bin"), payload.encode().unwrap()).unwrap();
    }

    /// The runner with a cleared environment, as the app starts it.
    fn command(&self, exe: &str) -> Command {
        let mut command = Command::new(exe);
        command
            .env_clear()
            .env("BOT_INVENTOR_PAYLOAD", self.path("payload.bin"))
            .env("BOT_INVENTOR_ENV_FILE", self.path(".env"))
            .env("BOT_INVENTOR_ASSETS_DIR", self.path("assets"))
            .env("BOT_INVENTOR_DATA_DIR", self.path("data"))
            .stdin(Stdio::null());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command(RUNNER).args(args).output().unwrap()
    }
}

#[test]
fn version_and_help() {
    let bot = Bot::new();
    let version = bot.run(&["--version"]);
    assert_eq!(code(&version), 0);
    assert_eq!(
        stdout(&version),
        format!("runner {}\n", env!("CARGO_PKG_VERSION"))
    );
    let help = bot.run(&["--help"]);
    assert_eq!(code(&help), 0);
    assert!(stdout(&help).contains("--reset-variable"));
}

#[test]
fn dump_prints_the_payload_as_the_codec_does() {
    let bot = Bot::new();
    let dump = bot.run(&["--dump"]);
    assert_eq!(code(&dump), 0);
    let expected = fs::read_to_string(sample("ping.json")).unwrap();
    let got: Value = serde_json::from_str(&stdout(&dump)).unwrap();
    let want: Value = serde_json::from_str(&expected).unwrap();
    assert_eq!(got, want);
    // `--payload` wins over the environment.
    let other = bot.run(&[
        "--dump",
        "--payload",
        sample("ping.payload").to_str().unwrap(),
    ]);
    assert_eq!(code(&other), 0);
}

#[test]
fn a_bad_command_line_exits_2_and_repeats_nothing() {
    let bot = Bot::new();
    for args in [
        vec!["--bogus"],
        vec![MARKER],
        vec!["--token", MARKER],
        vec!["--check", "--dump"],
        vec!["--payload"],
        vec!["--reset-variable", "nope"],
    ] {
        let output = bot.run(&args);
        assert_eq!(code(&output), 2, "{args:?}");
        assert_eq!(stderr(&output).lines().count(), 1, "{args:?}");
        never_shows_the_token(&output);
    }
}

#[test]
fn a_missing_or_damaged_payload() {
    let bot = Bot::new();
    fs::remove_file(bot.path("payload.bin")).unwrap();
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("payload.bin"));

    fs::write(bot.path("payload.bin"), b"not a payload").unwrap();
    assert_eq!(code(&bot.run(&["--check"])), 1);
    assert_eq!(code(&bot.run(&["--dump"])), 1);
    assert_eq!(code(&bot.run(&[])), 1);

    fs::write(bot.path("payload.bin"), b"").unwrap();
    assert_eq!(code(&bot.run(&["--check"])), 1);
}

#[test]
fn a_payload_version_the_runner_does_not_read_exits_3() {
    let bot = Bot::new();
    for version in [2, 99] {
        let content = rmp_serde::to_vec_named(&json!({ "version": version })).unwrap();
        fs::write(
            bot.path("payload.bin"),
            zstd::stream::encode_all(&content[..], 3).unwrap(),
        )
        .unwrap();
        for args in [vec!["--check"], vec!["--dump"], vec![]] {
            let output = bot.run(&args);
            assert_eq!(code(&output), 3, "version {version} {args:?}");
            assert!(stderr(&output).contains("Bot Inventor"));
        }
    }
}

#[test]
fn check_passes_without_connecting() {
    let bot = Bot::new();
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let line: Value = serde_json::from_str(stdout(&output).trim()).unwrap();
    assert_eq!(line["level"], "info");
    assert!(line["msg"].as_str().unwrap().contains("check passed"));
    never_shows_the_token(&output);
}

#[test]
fn check_finds_what_is_wrong_with_the_configuration() {
    let bot = Bot::new();

    bot.env("OTHER=1\n");
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("DISCORD_TOKEN"));

    bot.env("DISCORD_TOKEN=\n");
    assert_eq!(code(&bot.run(&["--check"])), 2);

    fs::remove_file(bot.path(".env")).unwrap();
    assert_eq!(code(&bot.run(&["--check"])), 2);

    bot.env(&format!(
        "DISCORD_TOKEN={MARKER}\nDISCORD_DEV_GUILD_ID=abc\n"
    ));
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("DISCORD_DEV_GUILD_ID"));
    never_shows_the_token(&output);
}

#[test]
fn a_missing_asset_exits_2_and_a_present_one_passes() {
    let bot = Bot::new();
    bot.payload(|payload| payload.requirements.assets = vec!["logo.png".to_owned()]);
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("logo.png"));

    fs::create_dir(bot.path("assets")).unwrap();
    fs::write(bot.path("assets/logo.png"), b"png").unwrap();
    assert_eq!(code(&bot.run(&["--check"])), 0);

    bot.payload(|payload| payload.requirements.assets = vec!["../.env".to_owned()]);
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 2);
    never_shows_the_token(&output);
}

#[test]
fn an_unknown_intent_exits_2() {
    let bot = Bot::new();
    bot.payload(|payload| payload.requirements.intents = vec!["not_an_intent".to_owned()]);
    let output = bot.run(&["--check"]);
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("not_an_intent"));
}

#[test]
fn a_bot_inside_the_executable_runs_without_a_payload_argument() {
    let bot = Bot::new();
    let copy = bot.path("my-bot");
    fs::copy(RUNNER, &copy).unwrap();
    let mut file = fs::OpenOptions::new().append(true).open(&copy).unwrap();
    write_container(&mut file, &fs::read(sample("ping.payload")).unwrap()).unwrap();
    drop(file);

    let mut command = bot.command(copy.to_str().unwrap());
    command.env_remove("BOT_INVENTOR_PAYLOAD").arg("--check");
    let output = command.output().unwrap();
    assert_eq!(code(&output), 0, "{}", stderr(&output));

    // The runner without a bot inside says what to do.
    let mut command = bot.command(RUNNER);
    command.env_remove("BOT_INVENTOR_PAYLOAD").arg("--check");
    let output = command.output().unwrap();
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("--payload"));
}

#[test]
fn without_environment_the_files_are_next_to_the_executable() {
    let bot = Bot::new();
    let copy = bot.path("my-bot");
    fs::copy(RUNNER, &copy).unwrap();
    let mut file = fs::OpenOptions::new().append(true).open(&copy).unwrap();
    write_container(&mut file, &fs::read(sample("ping.payload")).unwrap()).unwrap();
    drop(file);
    // No variable at all, and a working directory that is somewhere else.
    let output = Command::new(&copy)
        .env_clear()
        .current_dir(std::env::temp_dir())
        .arg("--check")
        .output()
        .unwrap();
    assert_eq!(code(&output), 0, "{}", stderr(&output));
}

#[test]
fn a_token_discord_rejects_exits_2_and_is_printed_nowhere() {
    let bot = Bot::new();
    let fake = FakeDiscord::answering(401, r#"{"message":"401: Unauthorized","code":0}"#);
    let output = bot
        .command(RUNNER)
        .env("BOT_INVENTOR_DISCORD_PROXY", &fake.address)
        .output()
        .unwrap();
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("DISCORD_TOKEN"));
    assert_eq!(stderr(&output).lines().count(), 1);
    never_shows_the_token(&output);
    for line in stdout(&output).lines() {
        let line: Value = serde_json::from_str(line).unwrap();
        assert!(line["ts"].is_string());
    }
}

#[test]
fn a_failing_discord_exits_1_and_the_token_is_printed_nowhere() {
    let bot = Bot::new();
    let fake = FakeDiscord::answering(500, &format!(r#"{{"message":"echo {MARKER}"}}"#));
    let output = bot
        .command(RUNNER)
        .env("BOT_INVENTOR_DISCORD_PROXY", &fake.address)
        .output()
        .unwrap();
    assert_eq!(code(&output), 1, "{}", stderr(&output));
    never_shows_the_token(&output);
}

#[test]
fn nothing_listens_at_the_proxy() {
    let bot = Bot::new();
    // A port that was free a moment ago.
    let address = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().to_string()
    };
    let output = bot
        .command(RUNNER)
        .env("BOT_INVENTOR_DISCORD_PROXY", &address)
        .output()
        .unwrap();
    assert_eq!(code(&output), 1, "{}", stderr(&output));
    never_shows_the_token(&output);
}

#[test]
fn a_termination_signal_stops_the_runner_cleanly() {
    for signal in ["TERM", "INT"] {
        let bot = Bot::new();
        let fake = FakeDiscord::silent();
        let child = bot
            .command(RUNNER)
            .env("BOT_INVENTOR_DISCORD_PROXY", &fake.address)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        // Wait for the data folder: the runner has validated everything and is connecting.
        let started = Instant::now();
        while !bot.path("data/bot.sqlite").exists() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "the runner did not start"
            );
            thread::sleep(Duration::from_millis(20));
        }
        thread::sleep(Duration::from_millis(300));
        let status = Command::new("kill")
            .arg(format!("-{signal}"))
            .arg(child.id().to_string())
            .status()
            .unwrap();
        assert!(status.success());
        let stopped = Instant::now();
        let output = child.wait_with_output().unwrap();
        assert!(
            stopped.elapsed() < Duration::from_secs(5),
            "SIG{signal} took too long"
        );
        assert_eq!(code(&output), 0, "SIG{signal}: {}", stderr(&output));
        assert!(stdout(&output).contains("stopped before the bot started listening"));
        for line in stdout(&output).lines() {
            serde_json::from_str::<Value>(line).unwrap();
        }
        never_shows_the_token(&output);
    }
}

#[test]
fn a_variable_reset_deletes_only_that_variable() {
    use runtime::storage::{Storage, StoredScope, StoredValue, VarKey, VarRef};
    use storage_sqlite::SqliteStorage;

    let bot = Bot::new();
    let variable = |name: &str| Variable {
        name: VariableName::parse(name).unwrap(),
        kind: VariableType::Integer,
        scope: VariableScope::Bot,
        initial: json!(0),
    };
    bot.payload(|payload| payload.variables = vec![variable("points"), variable("other")]);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let key = |name: &str| VarKey {
        scope: StoredScope::Bot,
        key: String::new(),
        name: VariableName::parse(name).unwrap(),
    };
    runtime.block_on(async {
        fs::create_dir_all(bot.path("data")).unwrap();
        let storage = SqliteStorage::open(&bot.path("data/bot.sqlite")).unwrap();
        storage
            .check_variables(&[variable("points"), variable("other")])
            .await
            .unwrap();
        storage
            .set(&key("points"), &StoredValue::Integer(5))
            .await
            .unwrap();
        storage
            .set(&key("other"), &StoredValue::Integer(7))
            .await
            .unwrap();
    });

    let output = bot.run(&["--reset-variable", "bot.points"]);
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert!(stdout(&output).contains("reset `bot.points`: 1 stored values deleted"));

    runtime.block_on(async {
        let storage = SqliteStorage::open(&bot.path("data/bot.sqlite")).unwrap();
        let values = storage
            .get_many(&[key("points"), key("other")])
            .await
            .unwrap();
        assert_eq!(values, vec![None, Some(StoredValue::Integer(7))]);
        // The reference parses the same way the flag does.
        assert_eq!(
            "bot.points".parse::<VarRef>().unwrap().to_string(),
            "bot.points"
        );
    });

    // A variable the bot does not declare, and a flag that is not a variable.
    let output = bot.run(&["--reset-variable", "bot.gone"]);
    assert_eq!(code(&output), 2);
    assert!(stderr(&output).contains("bot.gone"));
    assert_eq!(code(&bot.run(&["--reset-variable", "run.points"])), 2);
}

#[test]
fn a_changed_variable_type_stops_the_start_and_names_the_flag() {
    use runtime::storage::{Storage, StoredScope, StoredValue, VarKey};
    use storage_sqlite::SqliteStorage;

    let bot = Bot::new();
    let declared = |kind| Variable {
        name: VariableName::parse("points").unwrap(),
        kind,
        scope: VariableScope::Bot,
        initial: json!(0),
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    runtime.block_on(async {
        fs::create_dir_all(bot.path("data")).unwrap();
        let storage = SqliteStorage::open(&bot.path("data/bot.sqlite")).unwrap();
        storage
            .check_variables(&[declared(VariableType::Integer)])
            .await
            .unwrap();
        let key = VarKey {
            scope: StoredScope::Bot,
            key: String::new(),
            name: VariableName::parse("points").unwrap(),
        };
        storage.set(&key, &StoredValue::Integer(5)).await.unwrap();
    });
    bot.payload(|payload| payload.variables = vec![declared(VariableType::Text)]);
    let fake = FakeDiscord::silent();
    let output = bot
        .command(RUNNER)
        .env("BOT_INVENTOR_DISCORD_PROXY", &fake.address)
        .output()
        .unwrap();
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("--reset-variable bot.points"));
}
