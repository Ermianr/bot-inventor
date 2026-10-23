//! The `runner` binary: the signals, the exit code, and nothing else (the rest is in the
//! library, where it is tested).

use std::process::ExitCode;

use runner::{Command, Failure, Settings, execute, parse};
use tokio::signal::unix::{SignalKind, signal};

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args = match parse(std::env::args().skip(1)) {
        Ok(args) => args,
        Err(failure) => return fail(&failure),
    };
    let settings = Settings::from_process();
    let result = if args.command == Command::Run {
        // Both handlers stay installed until the process ends, so a second signal while the
        // bot closes does nothing.
        let (Ok(mut term), Ok(mut int)) = (
            signal(SignalKind::terminate()),
            signal(SignalKind::interrupt()),
        ) else {
            return fail(&Failure::other("cannot listen for termination signals"));
        };
        let stop = async {
            tokio::select! {
                _ = term.recv() => {}
                _ = int.recv() => {}
            }
        };
        execute(args, &settings, std::io::stdout(), stop).await
    } else {
        execute(args, &settings, std::io::stdout(), std::future::pending()).await
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => fail(&failure),
    }
}

fn fail(failure: &Failure) -> ExitCode {
    eprintln!("error: {failure}");
    failure.exit_code()
}
