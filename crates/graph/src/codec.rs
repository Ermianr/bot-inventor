//! The payload codec: MessagePack compressed with zstd (`docs/ARCHITECTURE.md` §3.2).
//!
//! Nothing here trusts its input. The size of the compressed bytes, of the decompressed
//! content and the nesting depth are bounded, a damaged payload is caught by the zstd
//! checksum, and every failure is a [`PayloadError`].

use std::io::{Read, Write};

use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::payload::{CURRENT_PAYLOAD_VERSION, Payload};

/// The most a payload may take, compressed. Provisional **[measure]**.
pub const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;

/// The most a payload may take once decompressed. Provisional **[measure]**.
pub const MAX_DECOMPRESSED_BYTES: usize = 64 * 1024 * 1024;

/// The deepest nesting of MessagePack values that is read, the same as `serde_json`.
pub const MAX_DEPTH: usize = 128;

/// The largest zstd window (as a power of two) that is accepted, so a frame cannot ask the
/// decoder for more memory than the limit above.
const WINDOW_LOG_MAX: u32 = 26;

/// Why a payload could not be encoded, decoded or dumped. A message says what to do when
/// the user can do something about it.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum PayloadError {
    #[error("the payload is empty")]
    Empty,

    #[error("the payload is damaged or is not a Bot Inventor payload: {0}")]
    Compressed(std::io::Error),

    #[error("the payload is larger than {limit} bytes {when}")]
    TooLarge { limit: usize, when: &'static str },

    #[error("the payload content is not valid: {0}")]
    Decode(#[from] rmp_serde::decode::Error),

    #[error("the payload could not be written: {0}")]
    Encode(#[from] rmp_serde::encode::Error),

    #[error("the payload has {0} bytes after its content")]
    TrailingData(usize),

    #[error("the payload version must be 1 or more")]
    InvalidVersion,

    #[error(
        "the payload has version {found}, but this version of Bot Inventor supports \
         {supported}; update Bot Inventor to run it"
    )]
    NewerVersion { found: u32, supported: u32 },

    #[error(
        "the payload has version {found}, but this version of Bot Inventor supports \
         {supported}; export the bot again with this version"
    )]
    OlderVersion { found: u32, supported: u32 },

    #[error("the payload is not consistent: {0}")]
    Inconsistent(String),

    #[error("the payload could not be printed as JSON: {0}")]
    Json(serde_json::Error),

    #[error("cannot read or write the payload: {0}")]
    Io(std::io::Error),

    #[error(
        "the file has a payload footer of container version {found}, but this version of \
         Bot Inventor supports {supported}; update Bot Inventor to run it"
    )]
    NewerContainer { found: u32, supported: u32 },

    #[error("the payload footer has container version 0")]
    InvalidContainer,

    #[error("the payload footer says {length} bytes, but the file has room for {available}")]
    BadContainerLength { length: u64, available: u64 },
}

/// The first field of a payload. It is read alone, so a payload of another version is
/// refused for its version and not for a shape that this version does not know.
#[derive(Deserialize)]
struct Header {
    version: u32,
}

impl Payload {
    /// Writes the payload as MessagePack compressed with zstd, with its content checksum.
    /// The same payload always gives the same bytes.
    ///
    /// # Errors
    ///
    /// The payload is refused if it is not of the current version, if an index points
    /// nowhere, or if it is larger than [`decode`](Self::decode) would accept.
    pub fn encode(&self) -> Result<Vec<u8>, PayloadError> {
        check_version(self.version)?;
        self.check()?;
        let content = rmp_serde::to_vec_named(self)?;
        if content.len() > MAX_DECOMPRESSED_BYTES {
            return Err(PayloadError::TooLarge {
                limit: MAX_DECOMPRESSED_BYTES,
                when: "once decompressed",
            });
        }
        let packed = compress(&content)?;
        if packed.len() > MAX_PAYLOAD_BYTES {
            return Err(PayloadError::TooLarge {
                limit: MAX_PAYLOAD_BYTES,
                when: "compressed",
            });
        }
        Ok(packed)
    }

    /// Reads a payload written by [`encode`](Self::encode).
    ///
    /// # Errors
    ///
    /// A [`PayloadError`] for bytes that are not a payload of the current version, that
    /// are damaged or too large, or whose indexes point nowhere. It never panics.
    pub fn decode(bytes: &[u8]) -> Result<Self, PayloadError> {
        if bytes.is_empty() {
            return Err(PayloadError::Empty);
        }
        if bytes.len() > MAX_PAYLOAD_BYTES {
            return Err(PayloadError::TooLarge {
                limit: MAX_PAYLOAD_BYTES,
                when: "compressed",
            });
        }
        let content = decompress(bytes)?;
        let header: Header = read_value(&content, false)?;
        check_version(header.version)?;
        let payload: Self = read_value(&content, true)?;
        payload.check()?;
        Ok(payload)
    }

    /// The payload as readable JSON, with a stable key order.
    ///
    /// # Errors
    ///
    /// [`PayloadError::Json`] if a value cannot be printed.
    pub fn to_json(&self) -> Result<String, PayloadError> {
        serde_json::to_string_pretty(self).map_err(PayloadError::Json)
    }
}

/// Decodes the bytes of a payload and prints it as JSON: what `--dump` shows.
///
/// # Errors
///
/// The errors of [`Payload::decode`].
pub fn dump_json(bytes: &[u8]) -> Result<String, PayloadError> {
    Payload::decode(bytes)?.to_json()
}

fn check_version(version: u32) -> Result<(), PayloadError> {
    check_version_against(version, CURRENT_PAYLOAD_VERSION)
}

/// Only the current version is read: a payload is built from a project each time a bot is
/// run or exported, so an older one is made again and does not need a reader.
fn check_version_against(version: u32, current: u32) -> Result<(), PayloadError> {
    match version {
        0 => Err(PayloadError::InvalidVersion),
        v if v > current => Err(PayloadError::NewerVersion {
            found: v,
            supported: current,
        }),
        v if v < current => Err(PayloadError::OlderVersion {
            found: v,
            supported: current,
        }),
        _ => Ok(()),
    }
}

fn compress(content: &[u8]) -> Result<Vec<u8>, PayloadError> {
    let mut encoder =
        zstd::stream::write::Encoder::new(Vec::new(), zstd::DEFAULT_COMPRESSION_LEVEL)
            .map_err(PayloadError::Io)?;
    encoder.include_checksum(true).map_err(PayloadError::Io)?;
    encoder.write_all(content).map_err(PayloadError::Io)?;
    encoder.finish().map_err(PayloadError::Io)
}

/// Decompresses up to [`MAX_DECOMPRESSED_BYTES`]; a frame that holds more is refused
/// without being read to its end.
fn decompress(bytes: &[u8]) -> Result<Vec<u8>, PayloadError> {
    let mut decoder = zstd::stream::read::Decoder::new(bytes).map_err(PayloadError::Compressed)?;
    decoder
        .window_log_max(WINDOW_LOG_MAX)
        .map_err(PayloadError::Compressed)?;
    let limit = u64::try_from(MAX_DECOMPRESSED_BYTES).unwrap_or(u64::MAX);
    let mut content = Vec::new();
    decoder
        .take(limit.saturating_add(1))
        .read_to_end(&mut content)
        .map_err(PayloadError::Compressed)?;
    if content.len() > MAX_DECOMPRESSED_BYTES {
        return Err(PayloadError::TooLarge {
            limit: MAX_DECOMPRESSED_BYTES,
            when: "once decompressed",
        });
    }
    Ok(content)
}

/// Reads one MessagePack value. With `whole`, bytes left after it are an error; without
/// it, the value is a prefix of a larger one and the rest is ignored.
fn read_value<T: DeserializeOwned>(content: &[u8], whole: bool) -> Result<T, PayloadError> {
    let mut reader = content;
    let mut deserializer = rmp_serde::Deserializer::new(&mut reader);
    deserializer.set_max_depth(MAX_DEPTH);
    let value = T::deserialize(&mut deserializer)?;
    if whole && !reader.is_empty() {
        return Err(PayloadError::TrailingData(reader.len()));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_current_version_is_accepted() {
        assert!(check_version_against(3, 3).is_ok());
        assert!(matches!(
            check_version_against(0, 3),
            Err(PayloadError::InvalidVersion)
        ));
        assert!(matches!(
            check_version_against(4, 3),
            Err(PayloadError::NewerVersion {
                found: 4,
                supported: 3
            })
        ));
        let older = check_version_against(2, 3);
        assert!(matches!(
            older,
            Err(PayloadError::OlderVersion {
                found: 2,
                supported: 3
            })
        ));
        assert!(older.is_err_and(|e| e.to_string().contains("export the bot again")));
    }
}
