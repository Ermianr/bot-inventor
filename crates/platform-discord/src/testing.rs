//! A fake Discord for the tests of the requests: a local HTTP server that answers with what the
//! test queued and records what it was asked. The network is not part of the suite.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, PoisonError};

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use twilight_http::Client;

/// A request the fake received.
#[derive(Debug, Clone)]
pub(crate) struct Seen {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) body: Value,
}

#[derive(Default)]
struct State {
    answers: VecDeque<(u16, String)>,
    seen: Vec<Seen>,
}

pub(crate) struct FakeDiscord {
    state: Arc<Mutex<State>>,
    address: String,
}

impl FakeDiscord {
    pub(crate) async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let state = Arc::new(Mutex::new(State::default()));
        let shared = Arc::clone(&state);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve(stream, Arc::clone(&shared)));
            }
        });
        Self { state, address }
    }

    /// A client of the twilight crate that talks to this fake.
    pub(crate) fn client(&self) -> Client {
        crate::tls::install();
        Client::builder()
            .token("fake-token-value".to_owned())
            .proxy(self.address.clone(), true)
            .ratelimiter(None)
            .build()
    }

    /// Queues the answer to the next request that has none yet.
    pub(crate) fn answer(&self, status: u16, body: &Value) {
        let body = if body.is_null() {
            String::new()
        } else {
            body.to_string()
        };
        self.state().answers.push_back((status, body));
    }

    pub(crate) fn seen(&self) -> Vec<Seen> {
        self.state().seen.clone()
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

async fn serve(mut stream: tokio::net::TcpStream, state: Arc<Mutex<State>>) {
    let mut buffer = Vec::new();
    loop {
        // Read until a whole request (head and body) is in the buffer.
        let (head_end, length) = loop {
            if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buffer[..end]).to_lowercase();
                let length = head
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .and_then(|value| value.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if buffer.len() >= end + 4 + length {
                    break (end, length);
                }
            }
            let mut chunk = [0u8; 4096];
            match stream.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            }
        };
        let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
        let body = buffer[head_end + 4..head_end + 4 + length].to_vec();
        buffer.drain(..head_end + 4 + length);
        let mut first = head.lines().next().unwrap_or_default().split(' ');
        let method = first.next().unwrap_or_default().to_owned();
        let path = first.next().unwrap_or_default().to_owned();
        let (status, answer) = {
            let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
            state.seen.push(Seen {
                method,
                path,
                body: serde_json::from_slice(&body).unwrap_or(Value::Null),
            });
            state.answers.pop_front().unwrap_or((500, String::new()))
        };
        let response = format!(
            "HTTP/1.1 {status} Fake\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{answer}",
            answer.len()
        );
        if stream.write_all(response.as_bytes()).await.is_err() {
            return;
        }
    }
}

/// A message as Discord returns it, with the given id.
pub(crate) fn message(id: &str) -> Value {
    json!({
        "id": id,
        "channel_id": "9",
        "author": { "id": "1", "username": "bot", "discriminator": "0", "avatar": null, "bot": true },
        "content": "Pong!",
        "timestamp": "2020-01-01T00:00:00.000000+00:00",
        "edited_timestamp": null,
        "tts": false,
        "mention_everyone": false,
        "mentions": [],
        "mention_roles": [],
        "attachments": [],
        "embeds": [],
        "pinned": false,
        "type": 0
    })
}
