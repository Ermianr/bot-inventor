//! The exporter on real folders. The runner is a stand-in file: the tests that run the real
//! runner are in `crates/runner/tests/export.rs`.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};

use exporter::{ENV_EXAMPLE, Export, ExportError, export};
use graph::{Payload, read_container};
use proptest::prelude::*;

const RUNNER_BYTES: &[u8] = b"\x7fELF-stand-in-for-the-runner\0\0\0";
const MARKER: &str = "MARKER-token-9f3a7c.should.never-appear";

fn ping() -> Payload {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../graph/tests/payload_samples/v1/ping.payload");
    Payload::decode(&fs::read(path).unwrap()).unwrap()
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

/// A project folder, a runner, and a place for the output.
struct Setup {
    dir: tempfile::TempDir,
}

impl Setup {
    fn new() -> Self {
        let setup = Self {
            dir: tempfile::tempdir().unwrap(),
        };
        fs::create_dir(setup.project()).unwrap();
        fs::write(setup.runner(), RUNNER_BYTES).unwrap();
        setup
    }

    fn project(&self) -> PathBuf {
        self.dir.path().join("project")
    }

    fn runner(&self) -> PathBuf {
        self.dir.path().join("runner")
    }

    fn out(&self) -> PathBuf {
        self.dir.path().join("out")
    }

    fn asset(&self, name: &str, bytes: &[u8]) {
        let path = self.project().join("assets").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn export(&self, payload: &Payload) -> Result<exporter::Exported, ExportError> {
        self.export_to(&self.out(), "my-bot", payload)
    }

    fn export_to(
        &self,
        out: &Path,
        name: &str,
        payload: &Payload,
    ) -> Result<exporter::Exported, ExportError> {
        export(&Export {
            runner: &self.runner(),
            payload,
            project: &self.project(),
            out,
            name,
        })
    }
}

/// Every path under `dir` with its kind, mode and contents, to compare two states.
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, String> {
    fn walk(base: &Path, dir: &Path, into: &mut BTreeMap<PathBuf, String>) {
        let Ok(read) = fs::read_dir(dir) else { return };
        for entry in read.flatten() {
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).unwrap();
            let key = path.strip_prefix(base).unwrap().to_path_buf();
            let what = if meta.is_dir() {
                walk(base, &path, into);
                format!("dir {:o}", meta.permissions().mode() & 0o777)
            } else if meta.is_symlink() {
                format!("link {}", fs::read_link(&path).unwrap().display())
            } else {
                format!(
                    "file {:o} {:?}",
                    meta.permissions().mode() & 0o777,
                    fs::read(&path).unwrap()
                )
            };
            into.insert(key, what);
        }
    }
    let mut into = BTreeMap::new();
    walk(dir, dir, &mut into);
    into
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[test]
fn the_executable_is_the_runner_then_the_payload_then_the_footer() {
    let setup = Setup::new();
    let payload = ping();
    let exported = setup.export(&payload).unwrap();
    assert_eq!(exported.executable, setup.out().join("my-bot"));
    assert_eq!(exported.assets, 0);

    let bytes = fs::read(&exported.executable).unwrap();
    assert!(bytes.starts_with(RUNNER_BYTES));
    let mut file = fs::File::open(&exported.executable).unwrap();
    let inside = read_container(&mut file).unwrap().unwrap();
    assert_eq!(inside, payload.encode().unwrap());
    assert_eq!(Payload::decode(&inside).unwrap(), payload);
    assert_eq!(mode(&exported.executable), 0o755);
    // Nothing else of the export is in the way: no staging folder is left behind.
    assert_eq!(names(&setup.out()), [".env.example", "assets", "my-bot"]);
    assert_eq!(mode(&setup.out()), 0o755);
    assert_eq!(mode(&setup.out().join("assets")), 0o755);
}

#[test]
fn the_assets_are_copied_whole_with_their_modes() {
    let setup = Setup::new();
    setup.asset("logo.png", b"png");
    setup.asset("img/deep/a.txt", b"a");
    // Whatever the mode in the project, the copy has the modes of an export.
    fs::set_permissions(
        setup.project().join("assets/logo.png"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let mut payload = ping();
    payload.requirements.assets = vec!["logo.png".to_owned(), "img/deep/a.txt".to_owned()];
    let exported = setup.export(&payload).unwrap();
    assert_eq!(exported.assets, 2);

    let assets = setup.out().join("assets");
    assert_eq!(fs::read(assets.join("logo.png")).unwrap(), b"png");
    assert_eq!(fs::read(assets.join("img/deep/a.txt")).unwrap(), b"a");
    assert_eq!(mode(&assets.join("logo.png")), 0o644);
    assert_eq!(mode(&assets.join("img")), 0o755);
    assert_eq!(mode(&assets.join("img/deep/a.txt")), 0o644);
}

#[test]
fn an_asset_the_bot_needs_and_the_project_lacks_refuses_the_export_and_writes_nothing() {
    let setup = Setup::new();
    setup.asset("other.png", b"x");
    let mut payload = ping();
    payload.requirements.assets = vec!["logo.png".to_owned()];
    let error = setup.export(&payload).unwrap_err();
    assert!(matches!(error, ExportError::MissingAsset { .. }));
    assert!(error.to_string().contains("logo.png"), "{error}");
    assert!(!setup.out().exists());

    // And into a folder that exists: it is as it was.
    fs::create_dir(setup.out()).unwrap();
    fs::write(setup.out().join("keep"), b"k").unwrap();
    let before = snapshot(&setup.out());
    setup.export(&payload).unwrap_err();
    assert_eq!(snapshot(&setup.out()), before);
}

#[test]
fn the_env_example_has_the_keys_and_no_value() {
    let setup = Setup::new();
    setup.export(&ping()).unwrap();
    let path = setup.out().join(ENV_EXAMPLE);
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.lines().any(|l| l == "DISCORD_TOKEN="), "{text}");
    assert!(
        text.lines().any(|l| l == "# DISCORD_DEV_GUILD_ID="),
        "{text}"
    );
    for line in text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        assert!(line.ends_with('='), "a value in `{line}`");
    }
    assert_eq!(mode(&path), 0o644);
    assert!(!setup.out().join(".env").exists());
    assert!(!setup.out().join("data").exists());
}

#[test]
fn the_token_and_the_databases_of_the_project_never_reach_the_output() {
    let setup = Setup::new();
    let project = setup.project();
    fs::write(project.join(".env"), format!("DISCORD_TOKEN={MARKER}\n")).unwrap();
    fs::create_dir_all(project.join(".botinventor/data")).unwrap();
    fs::write(project.join(".botinventor/data/bot.sqlite"), MARKER).unwrap();
    fs::write(project.join("bot.sqlite"), MARKER).unwrap();
    setup.asset("logo.png", b"png");
    setup.export(&ping()).unwrap();
    // Every path and every byte of the output, the executable included.
    let mut everything = Vec::new();
    for (path, what) in snapshot(&setup.out()) {
        assert!(!path.to_string_lossy().contains("sqlite"), "{path:?}");
        assert!(!path.to_string_lossy().contains(".botinventor"), "{path:?}");
        everything.extend_from_slice(what.as_bytes());
        if let Ok(bytes) = fs::read(setup.out().join(&path)) {
            everything.extend_from_slice(&bytes);
        }
    }
    let marker = MARKER.as_bytes();
    assert!(!everything.windows(marker.len()).any(|w| w == marker));
    assert!(!setup.out().join(".env").exists());
}

#[test]
fn a_runner_that_is_not_a_plain_runner_is_refused() {
    let setup = Setup::new();
    let payload = ping();

    // An exported bot given as the runner.
    setup.export(&payload).unwrap();
    let bot = setup.out().join("my-bot");
    let again = setup.dir.path().join("again");
    let error = export(&Export {
        runner: &bot,
        payload: &payload,
        project: &setup.project(),
        out: &again,
        name: "x",
    })
    .unwrap_err();
    assert!(matches!(error, ExportError::Runner { .. }), "{error}");
    assert!(!again.exists());

    // A folder, a missing file.
    for runner in [
        setup.dir.path().to_path_buf(),
        setup.dir.path().join("none"),
    ] {
        let error = export(&Export {
            runner: &runner,
            payload: &payload,
            project: &setup.project(),
            out: &again,
            name: "x",
        })
        .unwrap_err();
        assert!(
            matches!(error, ExportError::Runner { .. } | ExportError::Io { .. }),
            "{error}"
        );
        assert!(!again.exists());
    }
}

#[test]
fn a_bad_payload_is_refused_before_anything_is_written() {
    let setup = Setup::new();
    let mut payload = ping();
    payload.version = 0;
    assert!(matches!(
        setup.export(&payload).unwrap_err(),
        ExportError::Payload(_)
    ));
    assert!(!setup.out().exists());
}

#[test]
fn a_second_export_replaces_what_is_the_exporters_and_keeps_the_rest() {
    let setup = Setup::new();
    setup.asset("logo.png", b"v1");
    setup.asset("keep/me.txt", b"project");
    let payload = ping();
    setup.export(&payload).unwrap();

    // What the user did on the machine where the bot runs.
    let out = setup.out();
    fs::write(out.join(".env"), format!("DISCORD_TOKEN={MARKER}\n")).unwrap();
    fs::set_permissions(out.join(".env"), fs::Permissions::from_mode(0o600)).unwrap();
    fs::create_dir(out.join("data")).unwrap();
    fs::set_permissions(out.join("data"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(out.join("data/bot.sqlite"), b"database").unwrap();
    fs::write(out.join("assets/extra.png"), b"added by hand").unwrap();
    fs::write(out.join("notes.txt"), b"mine").unwrap();
    fs::write(out.join(ENV_EXAMPLE), b"edited").unwrap();
    let kept: Vec<_> = [
        ".env",
        "data",
        "data/bot.sqlite",
        "assets/extra.png",
        "notes.txt",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    let before = snapshot(&out);

    // The project changes: a new asset and a new image, and a bot with another payload.
    setup.asset("logo.png", b"v2");
    setup.asset("new.png", b"new");
    let mut changed = ping();
    changed.app_version = "9.9.9".to_owned();
    let exported = setup.export(&changed).unwrap();
    assert_eq!(exported.assets, 3);

    let after = snapshot(&out);
    for path in &kept {
        assert_eq!(after[path], before[path], "{path:?}");
    }
    assert_eq!(fs::read(out.join("assets/logo.png")).unwrap(), b"v2");
    assert_eq!(fs::read(out.join("assets/new.png")).unwrap(), b"new");
    assert_ne!(fs::read(out.join(ENV_EXAMPLE)).unwrap(), b"edited");
    let mut file = fs::File::open(out.join("my-bot")).unwrap();
    let inside = read_container(&mut file).unwrap().unwrap();
    assert_eq!(Payload::decode(&inside).unwrap(), changed);
    assert_eq!(mode(&out.join("my-bot")), 0o755);
}

#[test]
fn a_second_export_works_while_the_first_executable_runs() {
    // An executable that is running cannot be written to, but it can be replaced.
    let Some(sleep) = ["/usr/bin/sleep", "/bin/sleep"]
        .iter()
        .map(Path::new)
        .find(|p| p.exists())
    else {
        return;
    };
    let setup = Setup::new();
    fs::copy(sleep, setup.runner()).unwrap();
    let payload = ping();
    setup.export(&payload).unwrap();
    let mut child = std::process::Command::new(setup.out().join("my-bot"))
        .arg("30")
        .spawn()
        .unwrap();
    let result = setup.export(&payload);
    let _ = child.kill();
    let _ = child.wait();
    result.unwrap();
}

#[test]
fn an_error_in_the_middle_leaves_the_output_as_it_was() {
    let setup = Setup::new();
    setup.asset("a.png", b"a");
    setup.asset("z.png", b"z");
    let payload = ping();
    let out = setup.out();
    fs::create_dir(&out).unwrap();
    fs::write(out.join(".env"), b"keep").unwrap();
    let before = snapshot(&out);

    // A file the project cannot read: the copy stops after a.png was staged.
    let unreadable = setup.project().join("assets/z.png");
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::File::open(&unreadable).is_err() {
        let error = setup.export(&payload).unwrap_err();
        assert!(matches!(error, ExportError::Io { .. }), "{error}");
        assert_eq!(snapshot(&out), before);
        // And the output that did not exist is not left either.
        let fresh = setup.dir.path().join("fresh");
        setup.export_to(&fresh, "my-bot", &payload).unwrap_err();
        assert!(!fresh.exists());
    }
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o644)).unwrap();

    // A folder where the export would put a file, and a file where it would put a folder.
    for (path, folder) in [("my-bot", true), (ENV_EXAMPLE, true), ("assets", false)] {
        let target = out.join(path);
        if folder {
            fs::create_dir(&target).unwrap();
        } else {
            fs::write(&target, b"file").unwrap();
        }
        let before = snapshot(&out);
        let error = setup.export(&payload).unwrap_err();
        assert!(
            matches!(error, ExportError::Conflict { .. }),
            "{path}: {error}"
        );
        assert_eq!(snapshot(&out), before, "{path}");
        if folder {
            fs::remove_dir(&target).unwrap();
        } else {
            fs::remove_file(&target).unwrap();
        }
    }
    fs::create_dir_all(out.join("assets")).unwrap();
    fs::write(out.join("assets/a.png"), b"x").unwrap();
    fs::remove_file(out.join("assets/a.png")).unwrap();
    fs::create_dir(out.join("assets/a.png")).unwrap();
    let before = snapshot(&out);
    assert!(matches!(
        setup.export(&payload).unwrap_err(),
        ExportError::Conflict { .. }
    ));
    assert_eq!(snapshot(&out), before);
}

#[test]
fn a_link_in_the_output_cannot_take_the_export_out_of_it() {
    let setup = Setup::new();
    setup.asset("sub/a.png", b"a");
    let payload = ping();
    let out = setup.out();
    let elsewhere = setup.dir.path().join("elsewhere");
    fs::create_dir(&elsewhere).unwrap();
    fs::create_dir_all(out.join("assets")).unwrap();
    symlink(&elsewhere, out.join("assets/sub")).unwrap();
    assert!(matches!(
        setup.export(&payload).unwrap_err(),
        ExportError::Conflict { .. }
    ));
    assert!(names(&elsewhere).is_empty());

    fs::remove_file(out.join("assets/sub")).unwrap();
    fs::remove_dir(out.join("assets")).unwrap();
    symlink(&elsewhere, out.join("assets")).unwrap();
    assert!(matches!(
        setup.export(&payload).unwrap_err(),
        ExportError::Conflict { .. }
    ));
    assert!(names(&elsewhere).is_empty());
}

#[test]
fn an_asset_that_is_a_link_refuses_the_export() {
    let setup = Setup::new();
    setup.asset("ok.png", b"ok");
    let secret = setup.dir.path().join("secret");
    fs::write(&secret, MARKER).unwrap();
    symlink(&secret, setup.project().join("assets/leak.png")).unwrap();
    let error = setup.export(&ping()).unwrap_err();
    assert!(matches!(error, ExportError::Asset { .. }), "{error}");
    assert!(error.to_string().contains("leak.png"), "{error}");
    assert!(!error.to_string().contains("MARKER"));
    assert!(!setup.out().exists());
}

#[test]
fn the_output_must_be_a_folder_of_its_own() {
    let setup = Setup::new();
    setup.asset("a.png", b"a");
    let payload = ping();

    let file = setup.dir.path().join("file");
    fs::write(&file, b"x").unwrap();
    let error = setup.export_to(&file, "bot", &payload).unwrap_err();
    assert!(matches!(error, ExportError::Output { .. }), "{error}");

    let real = setup.dir.path().join("real");
    fs::create_dir(&real).unwrap();
    let link = setup.dir.path().join("link");
    symlink(&real, &link).unwrap();
    let error = setup.export_to(&link, "bot", &payload).unwrap_err();
    assert!(matches!(error, ExportError::Output { .. }), "{error}");
    assert!(names(&real).is_empty());

    // The project itself, and a place inside its `assets/` (which exists or not).
    let error = setup
        .export_to(&setup.project(), "bot", &payload)
        .unwrap_err();
    assert!(
        matches!(error, ExportError::OutputIsProject { .. }),
        "{error}"
    );
    let assets = setup.project().join("assets");
    for out in [
        assets.clone(),
        assets.join("new"),
        assets.join("a.png/../x"),
    ] {
        let error = setup.export_to(&out, "bot", &payload).unwrap_err();
        assert!(
            matches!(
                error,
                ExportError::OutputInsideAssets { .. }
                    | ExportError::Output { .. }
                    | ExportError::Io { .. }
            ),
            "{error}"
        );
    }
    assert!(!assets.join("new").exists());
    assert_eq!(names(&assets), ["a.png"]);

    // Its parent has to exist; nothing is created on the way.
    let deep = setup.dir.path().join("no/such/out");
    assert!(setup.export_to(&deep, "bot", &payload).is_err());
    assert!(!setup.dir.path().join("no").exists());
}

#[test]
fn bad_names_write_nothing() {
    let setup = Setup::new();
    let payload = ping();
    for name in ["", ".", "..", ".env", "a/b", "../x", "-x", "assets", "data"] {
        let error = setup.export_to(&setup.out(), name, &payload).unwrap_err();
        assert!(matches!(error, ExportError::InvalidName { .. }), "{name}");
        assert!(!setup.out().exists(), "{name}");
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn no_name_writes_outside_the_output(name in "\\PC{0,80}") {
        let setup = Setup::new();
        let result = setup.export_to(&setup.out(), &name, &ping());
        let outside = names(setup.dir.path());
        if let Ok(exported) = result {
            prop_assert_eq!(outside, ["out", "project", "runner"]);
            prop_assert_eq!(exported.executable.parent().unwrap(), setup.out());
        } else {
            prop_assert_eq!(outside, ["project", "runner"]);
        }
    }
}
