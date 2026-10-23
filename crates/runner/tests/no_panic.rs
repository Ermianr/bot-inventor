//! Arbitrary arguments, `.env` text, asset paths and secrets give errors or values, never a panic.

#![allow(clippy::unwrap_used, clippy::panic)]

use proptest::prelude::*;
use runner::env::EnvFile;
use runner::log::{JsonLog, Redactor};
use runner::{assets, parse};

proptest! {
    #[test]
    fn arguments(args in proptest::collection::vec(".{0,60}", 0..6)) {
        if let Err(failure) = parse(args) {
            prop_assert_eq!(failure.code(), 2);
            prop_assert!(!failure.message().contains('\n'));
        }
    }

    #[test]
    fn flags_with_values(flag in prop::sample::select(vec!["--payload", "--reset-variable"]), value in ".{0,60}") {
        let _ = parse([flag.to_owned(), value]);
    }

    #[test]
    fn env_text(text in ".{0,300}") {
        let env = EnvFile::parse(&text);
        let _ = env.get("DISCORD_TOKEN");
    }

    #[test]
    fn asset_paths(path in ".{0,80}") {
        let dir = tempfile::tempdir().unwrap();
        let _ = assets::check(&[path], dir.path());
    }

    #[test]
    fn redaction_never_leaves_the_secret(secret in "[ -~]{1,30}", before in ".{0,20}", after in ".{0,20}") {
        let redactor = Redactor::new(Some(&secret));
        let text = format!("{before}{secret}{after}");
        let cleaned = redactor.apply(&text);
        // A secret made of what is left after redacting could in theory re-form; ignore the
        // secrets that are part of the marker.
        prop_assume!(!"[redacted]".contains(secret.as_str()));
        prop_assert!(!cleaned.contains(secret.as_str()));
    }

    #[test]
    fn lines_with_any_text(secret in "[ -~]{1,30}", message in ".{0,200}") {
        let log = JsonLog::new(std::io::sink(), Redactor::new(Some(&secret)));
        log.info(&message);
        log.finish();
    }
}
