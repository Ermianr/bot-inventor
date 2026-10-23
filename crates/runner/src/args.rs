//! The command line (`docs/ARCHITECTURE.md` §9.3). Nothing here takes the token: it is read from
//! `.env`, and a message about an argument never repeats the argument.

use std::path::PathBuf;

use runtime::storage::VarRef;

use crate::failure::Failure;

pub const USAGE: &str = "\
Usage: runner [--payload <file>] [--dump | --check | --reset-variable <scope>.<name> | --version | --help]

  --payload <file>              Run the payload in <file> instead of the one at the end of this executable
  --dump                        Print the payload as JSON and exit
  --check                       Verify the payload, .env and assets without connecting, and exit
  --reset-variable <scope>.<name>
                                Delete the stored values of one variable and exit
  --version                     Print the version and exit
  --help                        Print this text and exit
";

/// What the runner was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Run,
    Dump,
    Check,
    ResetVariable(VarRef),
    Version,
    Help,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub command: Command,
    pub payload: Option<PathBuf>,
}

/// Reads the arguments after the program name.
///
/// # Errors
///
/// A configuration [`Failure`] for an argument that is unknown, repeated, without its value or
/// in a combination that makes no sense.
pub fn parse<I>(args: I) -> Result<Args, Failure>
where
    I: IntoIterator<Item = String>,
{
    let mut command = None;
    let mut payload = None;
    let mut args = args.into_iter().enumerate();
    while let Some((position, arg)) = args.next() {
        let chosen = match arg.as_str() {
            "--payload" => {
                if payload.is_some() {
                    return Err(usage("`--payload` is given more than once"));
                }
                let Some((_, value)) = args.next() else {
                    return Err(usage("`--payload` needs the path of a file"));
                };
                payload = Some(PathBuf::from(value));
                continue;
            }
            "--dump" => Command::Dump,
            "--check" => Command::Check,
            "--version" => Command::Version,
            "--help" | "-h" => Command::Help,
            "--reset-variable" => {
                let Some((_, value)) = args.next() else {
                    return Err(usage("`--reset-variable` needs `<scope>.<name>`"));
                };
                let variable = value
                    .parse::<VarRef>()
                    .map_err(|error| Failure::config(format!("`--reset-variable`: {error}")))?;
                Command::ResetVariable(variable)
            }
            other => return Err(unknown(position, other)),
        };
        if command.is_some() {
            return Err(usage(
                "give only one of `--dump`, `--check`, `--reset-variable`, `--version` and `--help`",
            ));
        }
        command = Some(chosen);
    }
    let command = command.unwrap_or(Command::Run);
    if payload.is_some() && matches!(command, Command::Version | Command::Help) {
        return Err(usage("`--payload` has no use with `--version` or `--help`"));
    }
    Ok(Args { command, payload })
}

fn usage(message: &str) -> Failure {
    Failure::config(format!("{message}; run `runner --help`"))
}

/// A flag is named (up to an `=`, where a value could start); anything else is only counted.
fn unknown(position: usize, arg: &str) -> Failure {
    if arg.starts_with("--") {
        let name: String = arg
            .split('=')
            .next()
            .unwrap_or_default()
            .chars()
            .take(40)
            .collect();
        usage(&format!("unknown option `{name}`"))
    } else {
        usage(&format!("unexpected argument number {}", position + 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_all(args: &[&str]) -> Result<Args, Failure> {
        parse(args.iter().map(|arg| (*arg).to_owned()))
    }

    #[test]
    fn no_arguments_run_the_embedded_payload() {
        let args = parse_all(&[]).unwrap();
        assert_eq!(args.command, Command::Run);
        assert_eq!(args.payload, None);
    }

    #[test]
    fn every_command_is_read() {
        assert_eq!(parse_all(&["--dump"]).unwrap().command, Command::Dump);
        assert_eq!(parse_all(&["--check"]).unwrap().command, Command::Check);
        assert_eq!(parse_all(&["--version"]).unwrap().command, Command::Version);
        assert_eq!(parse_all(&["--help"]).unwrap().command, Command::Help);
        let args = parse_all(&["--payload", "a.bin", "--check"]).unwrap();
        assert_eq!(args.command, Command::Check);
        assert_eq!(args.payload, Some(PathBuf::from("a.bin")));
        let reset = parse_all(&["--reset-variable", "server.points"]).unwrap();
        assert_eq!(
            reset.command,
            Command::ResetVariable("server.points".parse().unwrap())
        );
    }

    #[test]
    fn a_bad_command_line_is_a_configuration_error_that_repeats_nothing() {
        let secret = "MTIzNDU2.token-like.value";
        let bad: [&[&str]; 12] = [
            &["--payload"],
            &["--payload", "a", "--payload", "b"],
            &["--dump", "--check"],
            &["--check", "--check"],
            &["--version", "--payload", "a"],
            &["--reset-variable"],
            &["--reset-variable", "points"],
            &["--reset-variable", "run.points"],
            &["--reset-variable", "bot."],
            &["--bogus"],
            &[secret],
            &["--token=MTIzNDU2.token-like.value"],
        ];
        for args in bad {
            let failure = parse_all(args).unwrap_err();
            assert_eq!(failure.code(), 2, "{args:?}");
            assert!(!failure.message().contains("token-like"), "{args:?}");
            assert!(!failure.message().contains('\n'), "{args:?}");
        }
    }
}
