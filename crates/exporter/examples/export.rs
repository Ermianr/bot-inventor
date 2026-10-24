//! Writes the folder of an exported bot: `cargo run -p exporter --example export -- --runner
//! <runner> --payload <payload file> --project <project folder> --out <folder> [--name <name>]`.
//! The payload is what `crates/runtime/examples/compile.rs` writes; the app does the same through
//! `compile` and `exporter::export` when it exports a bot.

use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use exporter::{Export, export};
use graph::Payload;

const USAGE: &str = "usage: export --runner <runner> --payload <payload file> --project <project folder> --out <folder> [--name <name>]";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let (mut runner, mut payload, mut project, mut out, mut name) = (None, None, None, None, None);
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let slot = match flag.as_str() {
            "--runner" => &mut runner,
            "--payload" => &mut payload,
            "--project" => &mut project,
            "--out" => &mut out,
            "--name" => &mut name,
            _ => return Err(USAGE.into()),
        };
        *slot = Some(args.next().ok_or(USAGE)?);
    }
    let (Some(runner), Some(payload), Some(project), Some(out)) = (runner, payload, project, out)
    else {
        return Err(USAGE.into());
    };
    let payload = Payload::decode(&fs::read(payload)?)?;
    let name = name.unwrap_or_else(|| "bot".to_owned());
    let exported = export(&Export {
        runner: &PathBuf::from(runner),
        payload: &payload,
        project: &PathBuf::from(project),
        out: &PathBuf::from(out),
        name: &name,
    })?;
    println!(
        "exported `{}` with {} asset file(s)",
        exported.executable.display(),
        exported.assets
    );
    Ok(())
}
