//! Development tasks and CI checks: `cargo xtask <task>`.

mod layers;
mod tasks;

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use anyhow::{Context, Result, bail};

const HELP: &str = "\
Development tasks for Bot Inventor.

Usage: cargo xtask <task>

Tasks:
  dev                     Run the app in development mode
  lint                    fmt, clippy -D warnings, layers, eslint, prettier, svelte-check,
                          Effect diagnostics and cargo-deny
  test                    nextest, doc tests and vitest
  build                   Build the app
  layers                  Check the crate dependency rules (docs/ARCHITECTURE.md §2)
  bindings [--check]      Regenerate the TypeScript types; --check fails if they changed
";

fn main() -> ExitCode {
    match dispatch(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn dispatch(args: Vec<String>) -> Result<()> {
    let Some((task, rest)) = args.split_first() else {
        print!("{HELP}");
        return Ok(());
    };
    match task.as_str() {
        "dev" => tasks::dev(),
        "lint" => tasks::lint(),
        "test" => tasks::test(),
        "build" => tasks::build(),
        "layers" => layers::run(),
        "bindings" => tasks::bindings(rest),
        "help" | "--help" | "-h" => {
            print!("{HELP}");
            Ok(())
        }
        other => bail!("unknown task `{other}`\n\n{HELP}"),
    }
}

/// The root of the repository, whatever the directory `cargo xtask` runs from.
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

/// A command that also finds the tools installed with `cargo install`, even when
/// `~/.cargo/bin` is not in the PATH of the shell.
fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    let cargo_home = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".cargo")));
    if let Some(cargo_home) = cargo_home {
        let current = std::env::var_os("PATH").unwrap_or_default();
        let paths = std::iter::once(cargo_home.join("bin")).chain(std::env::split_paths(&current));
        if let Ok(path) = std::env::join_paths(paths) {
            command.env("PATH", path);
        }
    }
    command
}

/// Runs a command in the repository root, echoing it; fails if it does not succeed.
fn run(program: &str, args: &[&str]) -> Result<()> {
    run_in(&root(), program, args)
}

fn run_in(dir: &Path, program: &str, args: &[&str]) -> Result<()> {
    println!("$ {program} {}", args.join(" "));
    let status = command(program)
        .args(args)
        .current_dir(dir)
        .status()
        .with_context(|| format!("could not start `{program}`; is it installed?"))?;
    if !status.success() {
        bail!("`{program} {}` failed ({status})", args.join(" "));
    }
    Ok(())
}

/// Runs a command in the repository root and returns its standard output.
fn run_capture(program: &str, args: &[&str]) -> Result<String> {
    let output = command(program)
        .args(args)
        .current_dir(root())
        .output()
        .with_context(|| format!("could not start `{program}`; is it installed?"))?;
    if !output.status.success() {
        bail!(
            "`{program} {}` failed ({}): {}",
            args.join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    String::from_utf8(output.stdout).with_context(|| format!("`{program}` printed invalid UTF-8"))
}
