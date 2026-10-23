//! The tasks that run other tools: `dev`, `lint`, `test`, `build` and `bindings`.

use std::path::PathBuf;

use anyhow::{Result, bail};

use crate::{layers, root, run, run_capture, run_in};

/// The Tauri app: the Rust side lives in `src-tauri/`, the frontend next to it.
const APP: &str = "apps/desktop";
/// The generated TypeScript types, committed (`docs/DEVELOPMENT-GUIDE.md` §7).
const BINDINGS: &str = "apps/desktop/src/lib/bindings.ts";

fn app_dir() -> PathBuf {
    root().join(APP)
}

/// Runs a script of the frontend package.
fn pnpm(script: &str) -> Result<()> {
    run_in(&app_dir(), "pnpm", &["run", script])
}

/// Installs the frontend dependencies the first time, from the lockfile.
fn ensure_node_modules() -> Result<()> {
    if root().join("node_modules").is_dir() {
        return Ok(());
    }
    run("pnpm", &["install", "--frozen-lockfile"])
}

/// Builds the frontend the first time: the Tauri crate embeds `dist/` and does not compile
/// without it, so clippy and the tests need it too.
fn ensure_frontend_dist() -> Result<()> {
    if app_dir().join("dist").is_dir() {
        return Ok(());
    }
    pnpm("build")
}

/// Installs a cargo subcommand the first time, so a clean clone needs only Rust and pnpm.
fn ensure_cargo_tool(subcommand: &str, package: &str) -> Result<()> {
    if run_capture("cargo", &[subcommand, "--version"]).is_ok() {
        return Ok(());
    }
    println!("`cargo {subcommand}` is not installed; installing {package}");
    run("cargo", &["install", "--locked", package])
}

pub fn dev() -> Result<()> {
    ensure_node_modules()?;
    run_in(&app_dir(), "pnpm", &["run", "tauri", "dev"])
}

pub fn build() -> Result<()> {
    ensure_node_modules()?;
    run_in(&app_dir(), "pnpm", &["run", "tauri", "build"])
}

/// Runs every step even if one fails, so a contributor sees all the problems at once.
type Step = (&'static str, fn() -> Result<()>);

fn run_all(steps: &[Step]) -> Result<()> {
    let mut failed = Vec::new();
    for &(name, step) in steps {
        if let Err(error) = step() {
            eprintln!("error in `{name}`: {error:#}");
            failed.push(name);
        }
    }
    if failed.is_empty() {
        return Ok(());
    }
    bail!("failed: {}", failed.join(", "))
}

fn rustfmt() -> Result<()> {
    run("cargo", &["fmt", "--all", "--check"])
}

fn clippy() -> Result<()> {
    run(
        "cargo",
        &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--",
            "-D",
            "warnings",
        ],
    )
}

fn eslint() -> Result<()> {
    pnpm("lint")
}

fn prettier() -> Result<()> {
    pnpm("format:check")
}

fn svelte_check() -> Result<()> {
    pnpm("check")
}

fn effect_diagnostics() -> Result<()> {
    pnpm("effect")
}

fn cargo_deny() -> Result<()> {
    run("cargo", &["deny", "check", "--hide-inclusion-graph"])
}

pub fn lint() -> Result<()> {
    ensure_node_modules()?;
    ensure_frontend_dist()?;
    ensure_cargo_tool("deny", "cargo-deny")?;
    run_all(&[
        ("rustfmt", rustfmt),
        ("clippy", clippy),
        ("layers", layers::run),
        ("eslint", eslint),
        ("prettier", prettier),
        ("svelte-check", svelte_check),
        ("effect diagnostics", effect_diagnostics),
        ("cargo-deny", cargo_deny),
    ])
}

fn nextest() -> Result<()> {
    run("cargo", &["nextest", "run", "--workspace"])
}

/// nextest does not run doc tests.
fn doc_tests() -> Result<()> {
    run("cargo", &["test", "--workspace", "--doc"])
}

fn vitest() -> Result<()> {
    pnpm("test")
}

pub fn test() -> Result<()> {
    ensure_node_modules()?;
    ensure_frontend_dist()?;
    ensure_cargo_tool("nextest", "cargo-nextest")?;
    run_all(&[
        ("nextest", nextest),
        ("doc tests", doc_tests),
        ("vitest", vitest),
    ])
}

/// Regenerates the TypeScript types from Rust. With `--check`, fails when the committed file
/// differs from the generated one (the CI check).
pub fn bindings(args: &[String]) -> Result<()> {
    let check = match args {
        [] => false,
        [flag] if flag == "--check" => true,
        _ => bail!("usage: cargo xtask bindings [--check]"),
    };
    ensure_node_modules()?;
    ensure_frontend_dist()?;
    run(
        "cargo",
        &[
            "run",
            "--package",
            "desktop",
            "--example",
            "export_bindings",
        ],
    )?;
    // Prettier owns the layout of generated TypeScript, as of every other file.
    run_in(
        &app_dir(),
        "pnpm",
        &["exec", "prettier", "--write", "src/lib/bindings.ts"],
    )?;
    if check {
        run("git", &["diff", "--exit-code", "--", BINDINGS]).map_err(|_| {
            anyhow::anyhow!(
                "{BINDINGS} differs from the Rust types; run `cargo xtask bindings` and commit it"
            )
        })?;
    }
    Ok(())
}
