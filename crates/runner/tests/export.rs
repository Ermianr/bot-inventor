//! An exported bot as a process: the folder `exporter::export` writes, with the real runner in
//! it, moved somewhere else and started with nothing but the folder. The gateway has no stand-in
//! in the suite, so that the bot answers a command is the manual check of `docs/DISCORD-TEST.md`.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use exporter::{Export, export};
use runtime::graph::{Payload, Project};
use serde_json::Value;

mod common;
use common::{FakeDiscord, MARKER, code, never_shows_the_token, sample, stderr, stdout};

const RUNNER: &str = env!("CARGO_BIN_EXE_runner");

/// What `compile` makes of the Ping sample project.
fn compiled_ping() -> Payload {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../graph/tests/samples/v1/ping");
    let project = Project::load(&folder).unwrap().project;
    let report = runtime::compile::compile(&project, env!("CARGO_PKG_VERSION"));
    assert!(report.diagnostics.is_empty(), "{:?}", report.diagnostics);
    report.payload.unwrap()
}

/// A project folder that has `assets/logo.png`, and a place to put the exports.
struct World {
    dir: tempfile::TempDir,
}

impl World {
    fn new() -> Self {
        let world = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        fs::create_dir_all(world.dir.path().join("project/assets")).unwrap();
        fs::write(world.dir.path().join("project/assets/logo.png"), b"png").unwrap();
        world
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.path().join(name)
    }

    fn export(&self, out: &Path, payload: &Payload) {
        export(&Export {
            runner: Path::new(RUNNER),
            payload,
            project: &self.path("project"),
            out,
            name: "my-bot",
        })
        .unwrap();
    }

    /// The exported bot with nothing from the test's own environment, started from somewhere
    /// that is not its folder.
    fn bot(&self, folder: &Path) -> Command {
        let mut command = Command::new(folder.join("my-bot"));
        command
            .env_clear()
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null());
        command
    }
}

fn write_env(folder: &Path, text: &str) {
    let path = folder.join(".env");
    fs::write(&path, text).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
}

#[test]
fn the_exported_ping_dumps_what_compile_made() {
    let world = World::new();
    let out = world.path("out");
    world.export(&out, &compiled_ping());
    let output = world.bot(&out).arg("--dump").output().unwrap();
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    let got: Value = serde_json::from_str(&stdout(&output)).unwrap();
    let want: Value =
        serde_json::from_str(&fs::read_to_string(sample("ping.json")).unwrap()).unwrap();
    assert_eq!(got, want);
}

#[test]
fn the_moved_folder_starts_alone_and_a_second_export_does_not_disturb_it() {
    let world = World::new();
    let payload = compiled_ping();
    world.export(&world.path("made-here"), &payload);
    // Only the folder goes to the other place.
    fs::create_dir(world.path("elsewhere")).unwrap();
    let folder = world.path("elsewhere/bot");
    fs::rename(world.path("made-here"), &folder).unwrap();
    write_env(&folder, &format!("DISCORD_TOKEN={MARKER}\n"));

    let fake = FakeDiscord::silent();
    let child = world
        .bot(&folder)
        .env("BOT_INVENTOR_DISCORD_PROXY", &fake.address)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // The data folder appears once the runner has checked everything and is connecting.
    let started = Instant::now();
    while !folder.join("data/bot.sqlite").exists() {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the exported bot did not start"
        );
        thread::sleep(Duration::from_millis(20));
    }
    let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&folder.join("data")), 0o700);

    // Exported again into the same folder while it runs.
    let secret_before = fs::read(folder.join(".env")).unwrap();
    let database_before = fs::read(folder.join("data/bot.sqlite")).unwrap().len();
    world.export(&folder, &payload);
    assert_eq!(fs::read(folder.join(".env")).unwrap(), secret_before);
    assert_eq!(mode(&folder.join(".env")), 0o600);
    assert!(fs::read(folder.join("data/bot.sqlite")).unwrap().len() >= database_before);
    assert_eq!(mode(&folder.join("data")), 0o700);

    let status = Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    let output = child.wait_with_output().unwrap();
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    never_shows_the_token(&output);
}

#[test]
fn an_exported_folder_says_what_it_lacks() {
    let world = World::new();
    let mut payload = compiled_ping();
    payload.requirements.assets = vec!["logo.png".to_owned()];
    let folder = world.path("out");
    world.export(&folder, &payload);

    // No `.env`: it names the file it looked for.
    let output = world.bot(&folder).arg("--check").output().unwrap();
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(
        stderr(&output).contains(&folder.join(".env").display().to_string()),
        "{}",
        stderr(&output)
    );

    // The example, copied as it is, has no token.
    fs::copy(folder.join(".env.example"), folder.join(".env")).unwrap();
    let output = world.bot(&folder).arg("--check").output().unwrap();
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("DISCORD_TOKEN"),
        "{}",
        stderr(&output)
    );
    assert!(stderr(&output).contains("not set"), "{}", stderr(&output));

    // With a token and its asset it passes; without the asset it names it.
    write_env(&folder, &format!("DISCORD_TOKEN={MARKER}\n"));
    let output = world.bot(&folder).arg("--check").output().unwrap();
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    fs::remove_file(folder.join("assets/logo.png")).unwrap();
    let output = world.bot(&folder).arg("--check").output().unwrap();
    assert_eq!(code(&output), 2, "{}", stderr(&output));
    assert!(stderr(&output).contains("logo.png"), "{}", stderr(&output));
    never_shows_the_token(&output);
}
