//! The container of an exported bot: `[runner executable][payload][footer]`
//! (`docs/ARCHITECTURE.md` §3.2).
//!
//! The footer has a fixed size and sits at the very end, so the runner finds its payload by
//! reading the end of its own executable, without reading the executable.

use std::io::{Read, Seek, SeekFrom, Write};

use crate::codec::{MAX_PAYLOAD_BYTES, PayloadError};

/// The first bytes of the footer.
pub const MAGIC: [u8; 8] = *b"BOTINVPL";

/// The version of the container this crate reads and writes.
pub const CONTAINER_VERSION: u32 = 1;

/// The size of the footer: the magic, the container version (`u32`) and the payload length
/// (`u64`), the numbers in little-endian.
pub const FOOTER_LEN: usize = 8 + 4 + 8;

/// Writes the payload and its footer. The caller has written the runner before.
///
/// # Errors
///
/// The payload is refused if it is larger than [`MAX_PAYLOAD_BYTES`], so a container that
/// is written can be read back.
pub fn write_container<W: Write>(out: &mut W, payload: &[u8]) -> Result<(), PayloadError> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(PayloadError::TooLarge {
            limit: MAX_PAYLOAD_BYTES,
            when: "compressed",
        });
    }
    let length = u64::try_from(payload.len()).unwrap_or(u64::MAX);
    let mut footer = [0_u8; FOOTER_LEN];
    footer[..8].copy_from_slice(&MAGIC);
    footer[8..12].copy_from_slice(&CONTAINER_VERSION.to_le_bytes());
    footer[12..].copy_from_slice(&length.to_le_bytes());
    out.write_all(payload).map_err(PayloadError::Io)?;
    out.write_all(&footer).map_err(PayloadError::Io)
}

/// Finds the payload at the end of `file` and returns its bytes, or `None` if the file has
/// no footer (it is shorter than one or does not end with the magic), so a runner can fall
/// back to `--payload`.
///
/// # Errors
///
/// A footer that is there but cannot be trusted: a newer container version, or a length
/// larger than the file or than [`MAX_PAYLOAD_BYTES`].
pub fn read_container<R: Read + Seek>(file: &mut R) -> Result<Option<Vec<u8>>, PayloadError> {
    let size = file.seek(SeekFrom::End(0)).map_err(PayloadError::Io)?;
    let footer_len = FOOTER_LEN as u64;
    let Some(footer_start) = size.checked_sub(footer_len) else {
        return Ok(None);
    };
    file.seek(SeekFrom::Start(footer_start))
        .map_err(PayloadError::Io)?;
    let mut footer = [0_u8; FOOTER_LEN];
    file.read_exact(&mut footer).map_err(PayloadError::Io)?;
    if footer[..8] != MAGIC {
        return Ok(None);
    }
    let version = u32::from_le_bytes([footer[8], footer[9], footer[10], footer[11]]);
    if version == 0 {
        return Err(PayloadError::InvalidContainer);
    }
    if version > CONTAINER_VERSION {
        return Err(PayloadError::NewerContainer {
            found: version,
            supported: CONTAINER_VERSION,
        });
    }
    let mut length_bytes = [0_u8; 8];
    length_bytes.copy_from_slice(&footer[12..]);
    let length = u64::from_le_bytes(length_bytes);
    if length > footer_start {
        return Err(PayloadError::BadContainerLength {
            length,
            available: footer_start,
        });
    }
    let limit = u64::try_from(MAX_PAYLOAD_BYTES).unwrap_or(u64::MAX);
    if length > limit {
        return Err(PayloadError::TooLarge {
            limit: MAX_PAYLOAD_BYTES,
            when: "compressed",
        });
    }
    file.seek(SeekFrom::Start(footer_start - length))
        .map_err(PayloadError::Io)?;
    let mut payload = vec![0_u8; usize::try_from(length).unwrap_or(0)];
    file.read_exact(&mut payload).map_err(PayloadError::Io)?;
    Ok(Some(payload))
}
