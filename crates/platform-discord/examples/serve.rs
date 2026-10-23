//! Runs a bot on a real Discord server: `cargo run -p platform-discord --example serve -- --project <folder>`.
//!
//! This is the manual check of M7 (`docs/DISCORD-TEST.md`); the `runner` replaces it in M8. It
//! takes the bot from `--payload <file>` or compiles the `.botproj` folder of `--project`, and
//! reads `DISCORD_TOKEN` (and, optionally, `DISCORD_DEV_GUILD_ID`) from the file of `--env`
//! (`.env` by default). The token is never taken from an argument, and nothing here prints it.

use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use platform_discord::{Discord, Token};
use runtime::graph::{Payload, Project};
use runtime::run::{Level, LogRecord, RunLog, Runtime};

struct StderrLog;

impl RunLog for StderrLog {
    fn record(&self, record: LogRecord) {
        let level = match record.level {
            Level::Warn => "warn",
            Level::Error => "error",
        };
        eprintln!(
            "{level}: {}{} {}",
            record.flow.as_deref().unwrap_or("-"),
            record
                .node
                .map(|node| format!("/{node}"))
                .unwrap_or_default(),
            record.message
        );
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error>> {
    let mut payload_path = None;
    let mut project_path = None;
    let mut env_path = ".env".to_owned();
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or(format!("`{flag}` needs a value"))?;
        match flag.as_str() {
            "--payload" => payload_path = Some(value),
            "--project" => project_path = Some(value),
            "--env" => env_path = value,
            _ => return Err(format!("unknown argument `{flag}`").into()),
        }
    }
    let payload = match (payload_path, project_path) {
        (Some(path), None) => Payload::decode(&fs::read(path)?)?,
        (None, Some(path)) => compile(Path::new(&path))?,
        _ => return Err("give exactly one of --payload <file> or --project <folder>".into()),
    };

    let env = read_env(Path::new(&env_path))?;
    let token = env
        .get("DISCORD_TOKEN")
        .and_then(|token| Token::new(token))
        .ok_or("DISCORD_TOKEN is not set in the env file")?;

    let log = Arc::new(StderrLog);
    let (discord, platform) = Discord::connect(&token, &payload.requirements).await?;
    let report = discord
        .sync_commands(
            env.get("DISCORD_DEV_GUILD_ID").map(String::as_str),
            &payload.commands,
        )
        .await?;
    eprintln!(
        "commands: {} created, {} updated, {} deleted",
        report.created, report.updated, report.deleted
    );

    let runtime = Runtime::new(&payload, platform, log.clone())?;
    eprintln!("listening; press Ctrl+C to stop");
    let stopped = std::cell::Cell::new(None);
    discord
        .run(&runtime, log.as_ref(), async {
            let _ = tokio::signal::ctrl_c().await;
            eprintln!("stopping; the next Ctrl+C is ignored until the bot has closed");
            stopped.set(Some(Instant::now()));
        })
        .await?;
    if let Some(since) = stopped.get() {
        eprintln!("gateway closed after {} ms", since.elapsed().as_millis());
    }
    let _ = tokio::time::timeout(Duration::from_secs(10), runtime.drain()).await;
    if let Some(since) = stopped.get() {
        eprintln!("stopped after {} ms", since.elapsed().as_millis());
    }
    Ok(())
}

fn compile(folder: &Path) -> Result<Payload, Box<dyn Error>> {
    let project = Project::load(folder)?.project;
    let report = runtime::compile::compile(&project, env!("CARGO_PKG_VERSION"));
    for diagnostic in &report.diagnostics {
        eprintln!("{:?}: {}", diagnostic.code, diagnostic.message);
    }
    report
        .payload
        .ok_or_else(|| "the project has errors and cannot be run".into())
}

/// `KEY=VALUE` lines; blank lines and `#` comments are skipped, and a value may be quoted.
fn read_env(path: &Path) -> Result<HashMap<String, String>, Box<dyn Error>> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode();
        if mode & 0o077 != 0 {
            eprintln!("warning: the env file can be read by other users; run `chmod 600` on it");
        }
    }
    let mut values = HashMap::new();
    for line in fs::read_to_string(path)?.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
            values.insert(key.trim().to_owned(), value.to_owned());
        }
    }
    Ok(values)
}
