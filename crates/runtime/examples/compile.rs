//! Compiles a project folder into a payload file: `cargo run -p runtime --example compile --
//! <project folder> <payload file>`. It is how `docs/DISCORD-TEST.md` makes the payloads it
//! runs; the app does the same through `compile` when it runs or exports a bot.

use std::error::Error;
use std::fs;
use std::path::Path;
use std::process::ExitCode;

use runtime::graph::Project;

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
    let mut args = std::env::args().skip(1);
    let (Some(folder), Some(out), None) = (args.next(), args.next(), args.next()) else {
        return Err("usage: compile <project folder> <payload file>".into());
    };
    let project = Project::load(Path::new(&folder))?.project;
    let report = runtime::compile::compile(&project, env!("CARGO_PKG_VERSION"));
    for diagnostic in &report.diagnostics {
        eprintln!("{:?}: {}", diagnostic.code, diagnostic.message);
    }
    let payload = report
        .payload
        .ok_or("the project has errors and cannot be compiled")?;
    fs::write(out, payload.encode()?)?;
    Ok(())
}
