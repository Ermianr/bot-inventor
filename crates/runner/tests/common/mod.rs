//! What the tests of the runner as a process share.

#![allow(dead_code, clippy::unwrap_used, clippy::panic)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Output;
use std::thread;
use std::time::Duration;

pub const MARKER: &str = "MARKER-token-9f3a7c.should.never-appear";

pub fn sample(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../graph/tests/payload_samples/v1")
        .join(name)
}

pub fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

pub fn code(output: &Output) -> i32 {
    output.status.code().unwrap()
}

pub fn never_shows_the_token(output: &Output) {
    assert!(!stdout(output).contains("MARKER"), "{}", stdout(output));
    assert!(!stderr(output).contains("MARKER"), "{}", stderr(output));
}

/// A stand-in for Discord's HTTP API: it answers every request with `status` and `body`, or
/// reads the request and never answers.
pub struct FakeDiscord {
    pub address: String,
}

impl FakeDiscord {
    pub fn answering(status: u16, body: &str) -> Self {
        Self::start(Some((status, body.to_owned())))
    }

    pub fn silent() -> Self {
        Self::start(None)
    }

    fn start(answer: Option<(u16, String)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let answer = answer.clone();
                thread::spawn(move || serve(stream, answer));
            }
        });
        Self { address }
    }
}

fn serve(mut stream: TcpStream, answer: Option<(u16, String)>) {
    let mut seen = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(read) => seen.extend_from_slice(&chunk[..read]),
        }
        if seen.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let Some((status, body)) = answer else {
        // Hold the connection open and say nothing.
        thread::sleep(Duration::from_secs(60));
        return;
    };
    let response = format!(
        "HTTP/1.1 {status} Fake\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}
