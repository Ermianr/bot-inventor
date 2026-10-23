//! What the runner does for each command (`docs/ARCHITECTURE.md` §9.3).

use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use platform_discord::{Discord, DiscordPlatform, Token, check_guild_id, intents};
use runtime::expr::CelEngine;
use runtime::graph::{Payload, dump_json};
use runtime::platform::MockPlatform;
use runtime::run::{Limits, NoLog, RunLog, Runtime};
use runtime::storage::{Storage, StoredScope, VarRef};
use storage_sqlite::SqliteStorage;

use crate::args::{Args, Command, USAGE};
use crate::env::{self, DEV_GUILD_KEY, EnvFile, Settings, TOKEN_KEY};
use crate::failure::Failure;
use crate::log::{JsonLog, Redactor};
use crate::{assets, data, source};

/// How long a stop waits for the runs in progress.
pub const GRACE: Duration = Duration::from_secs(5);

/// Does what `args` asks. `out` is standard output; `stop` is ready when the bot must stop
/// (a termination signal), and is only looked at by a bot that is running.
///
/// # Errors
///
/// A [`Failure`] with the exit code and the one line that says what to fix.
pub async fn execute<W>(
    args: Args,
    settings: &Settings,
    mut out: W,
    stop: impl Future<Output = ()>,
) -> Result<(), Failure>
where
    W: Write + Send + 'static,
{
    match &args.command {
        Command::Version => {
            let _ = writeln!(out, "runner {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Command::Help => {
            let _ = write!(out, "{USAGE}");
            Ok(())
        }
        Command::Dump => {
            let bytes = payload_bytes(&args, settings)?;
            let _ = writeln!(out, "{}", dump_json(&bytes)?);
            Ok(())
        }
        Command::Check => check(&args, settings, out),
        Command::ResetVariable(variable) => reset(&args, settings, out, variable).await,
        Command::Run => serve(&args, settings, out, stop).await,
    }
}

fn payload_bytes(args: &Args, settings: &Settings) -> Result<Vec<u8>, Failure> {
    source::read(args.payload.as_deref(), settings.payload.as_deref())
}

/// What the `.env` gives, checked: the token and the development server.
struct Credentials {
    token: Token,
    redactor: Redactor,
    dev_guild: Option<String>,
    shared: bool,
}

fn credentials(settings: &Settings) -> Result<Credentials, Failure> {
    let loaded = env::load(&settings.env_file)?;
    let file: &EnvFile = &loaded.file;
    let Some(text) = file.get(TOKEN_KEY) else {
        return Err(Failure::config(format!(
            "`{TOKEN_KEY}` is not set in `{}`: add a line `{TOKEN_KEY}=<the bot token>`",
            settings.env_file.display()
        )));
    };
    let token = Token::new(text)
        .ok_or_else(|| Failure::config(format!("`{TOKEN_KEY}` in the env file is empty")))?;
    let redactor = Redactor::new(Some(text.trim()));
    let dev_guild = file.get(DEV_GUILD_KEY).map(str::to_owned);
    if let Some(guild) = &dev_guild {
        check_guild_id(guild).map_err(|error| {
            Failure::from(error).with_message(|message| redactor.apply(message))
        })?;
    }
    Ok(Credentials {
        token,
        redactor,
        dev_guild,
        shared: loaded.shared,
    })
}

/// Everything that can be known without a connection: that the payload is read, the nodes can
/// be prepared and the gateway names are known, and that the assets exist.
fn validate(payload: &Payload, settings: &Settings) -> Result<(), Failure> {
    intents::intents(&payload.requirements.intents)?;
    intents::resources(&payload.requirements.cache)?;
    assets::check(&payload.requirements.assets, &settings.assets_dir)?;
    Runtime::new(payload, MockPlatform::new(), Arc::new(NoLog))?;
    Ok(())
}

fn check<W: Write + Send + 'static>(
    args: &Args,
    settings: &Settings,
    out: W,
) -> Result<(), Failure> {
    let payload = Payload::decode(&payload_bytes(args, settings)?)?;
    let credentials = credentials(settings)?;
    let log = JsonLog::new(out, credentials.redactor.clone());
    warn_if_shared(&log, &credentials);
    validate(&payload, settings)?;
    log.info(&format!(
        "the check passed: {} flows, {} commands, {} assets",
        payload.flows.len(),
        payload.commands.len(),
        payload.requirements.assets.len()
    ));
    log.finish();
    Ok(())
}

async fn reset<W: Write + Send + 'static>(
    args: &Args,
    settings: &Settings,
    out: W,
    variable: &VarRef,
) -> Result<(), Failure> {
    let payload = Payload::decode(&payload_bytes(args, settings)?)?;
    let declared = payload.variables.iter().any(|declared| {
        StoredScope::of(declared.scope) == Some(variable.scope) && declared.name == variable.name
    });
    if !declared {
        return Err(Failure::config(format!(
            "the bot does not declare the variable `{variable}`"
        )));
    }
    let storage = data::open(&settings.data_dir)?;
    let deleted = storage.reset_variable(variable).await?;
    let log = JsonLog::new(out, Redactor::default());
    log.info(&format!(
        "reset `{variable}`: {deleted} stored values deleted"
    ));
    log.finish();
    Ok(())
}

fn warn_if_shared<W: Write + Send + 'static>(log: &JsonLog<W>, credentials: &Credentials) {
    if credentials.shared {
        log.warn("the env file can be read by other users; run `chmod 600` on it");
    }
}

async fn serve<W>(
    args: &Args,
    settings: &Settings,
    out: W,
    stop: impl Future<Output = ()>,
) -> Result<(), Failure>
where
    W: Write + Send + 'static,
{
    let payload = Payload::decode(&payload_bytes(args, settings)?)?;
    let credentials = credentials(settings)?;
    let redactor = credentials.redactor.clone();
    let log = Arc::new(JsonLog::new(out, redactor.clone()));
    let result = run_bot(&payload, settings, &credentials, &log, stop).await;
    log.finish();
    result.map_err(|failure| failure.with_message(|message| redactor.apply(message)))
}

async fn run_bot<W>(
    payload: &Payload,
    settings: &Settings,
    credentials: &Credentials,
    log: &Arc<JsonLog<W>>,
    stop: impl Future<Output = ()>,
) -> Result<(), Failure>
where
    W: Write + Send + 'static,
{
    warn_if_shared(log, credentials);
    validate(payload, settings)?;
    let storage = data::open(&settings.data_dir)?;
    storage.check_variables(&payload.variables).await?;

    let mut stop = std::pin::pin!(stop);
    log.info("starting");
    let started = tokio::select! {
        started = start(payload, settings, credentials, storage, log) => Some(started?),
        () = stop.as_mut() => None,
    };
    let Some((discord, runtime)) = started else {
        log.info("stopped before the bot started listening");
        return Ok(());
    };

    log.info("listening");
    let run_log: &dyn RunLog = log.as_ref();
    let ended = discord.run(&runtime, run_log, stop.as_mut()).await;

    log.info("stopping: waiting for the runs in progress");
    if tokio::time::timeout(GRACE, runtime.drain()).await.is_err() {
        log.warn(&format!(
            "some runs did not finish in {} seconds and were left behind",
            GRACE.as_secs()
        ));
    }
    drop(runtime);
    log.info("stopped");
    Ok(ended?)
}

type Bot = (Discord, Runtime<DiscordPlatform, SqliteStorage>);

async fn start<W>(
    payload: &Payload,
    settings: &Settings,
    credentials: &Credentials,
    storage: SqliteStorage,
    log: &Arc<JsonLog<W>>,
) -> Result<Bot, Failure>
where
    W: Write + Send + 'static,
{
    let (discord, platform) = Discord::connect_via(
        &credentials.token,
        &payload.requirements,
        settings.proxy.as_deref(),
    )
    .await?;
    let report = discord
        .sync_commands(credentials.dev_guild.as_deref(), &payload.commands)
        .await?;
    log.info(&format!(
        "commands: {} created, {} updated, {} deleted",
        report.created, report.updated, report.deleted
    ));
    let run_log: Arc<dyn RunLog> = log.clone();
    let runtime = Runtime::with_storage(
        payload,
        platform,
        storage,
        run_log,
        &CelEngine::new(),
        Limits::default(),
    )?;
    Ok((discord, runtime))
}
