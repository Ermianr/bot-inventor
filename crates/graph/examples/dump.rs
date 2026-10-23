//! Prints a payload as JSON: `cargo xtask dump <file>`.
//!
//! The file is a payload, or an exported bot with a payload at its end. This is what
//! `runner --dump` shows, through the same function.

use std::error::Error;
use std::fs::File;
use std::io::{Read, Seek};
use std::process::ExitCode;

use graph::{MAX_PAYLOAD_BYTES, dump_json, read_container};

fn main() -> ExitCode {
    match run() {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<String, Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let (Some(path), None) = (args.next(), args.next()) else {
        return Err("usage: dump <payload or exported bot>".into());
    };
    let mut file = File::open(&path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let bytes = match read_container(&mut file)? {
        Some(payload) => payload,
        None => {
            file.rewind()?;
            let limit = u64::try_from(MAX_PAYLOAD_BYTES)?;
            let mut bytes = Vec::new();
            file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
            bytes
        }
    };
    Ok(dump_json(&bytes)?)
}
