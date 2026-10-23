//! The interactions waiting for an answer. The runtime only holds an interaction's id; the
//! token that answers it stays here, in memory, until it expires.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::time::Instant;

/// Discord accepts follow-ups for 15 minutes; a minute is left to spare.
const LIFETIME: Duration = Duration::from_secs(14 * 60);

/// How many interactions are kept at most. The runtime allows 64 runs at once and a run lasts a
/// minute at most, so the oldest ones are long finished when this is reached.
const CAPACITY: usize = 1024;

#[derive(Debug, Default)]
pub(crate) struct Interactions {
    entries: Mutex<HashMap<String, Entry>>,
}

struct Entry {
    token: String,
    since: Instant,
    /// Whether the user sees "thinking" and the next message completes it.
    deferred: bool,
}

/// What the platform needs to answer an interaction.
pub(crate) struct Waiting {
    pub(crate) token: String,
    pub(crate) deferred: bool,
}

impl std::fmt::Debug for Entry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Entry")
            .field("deferred", &self.deferred)
            .finish_non_exhaustive()
    }
}

impl Interactions {
    pub(crate) fn insert(&self, id: String, token: String) {
        let mut entries = self.entries();
        entries.retain(|_, entry| entry.since.elapsed() < LIFETIME);
        if entries.len() >= CAPACITY {
            let oldest = entries
                .iter()
                .min_by_key(|(_, entry)| entry.since)
                .map(|(id, _)| id.clone());
            if let Some(oldest) = oldest {
                entries.remove(&oldest);
            }
        }
        entries.insert(
            id,
            Entry {
                token,
                since: Instant::now(),
                deferred: false,
            },
        );
    }

    /// The token of `id` and whether it was deferred, unless it is unknown or expired.
    pub(crate) fn waiting(&self, id: &str) -> Option<Waiting> {
        let entries = self.entries();
        let entry = entries.get(id)?;
        (entry.since.elapsed() < LIFETIME).then(|| Waiting {
            token: entry.token.clone(),
            deferred: entry.deferred,
        })
    }

    pub(crate) fn set_deferred(&self, id: &str, deferred: bool) {
        if let Some(entry) = self.entries().get_mut(id) {
            entry.deferred = deferred;
        }
    }

    pub(crate) fn forget(&self, id: &str) {
        self.entries().remove(id);
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries().len()
    }

    fn entries(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_interaction_is_found_until_it_is_forgotten() {
        let store = Interactions::default();
        store.insert("1".to_owned(), "token-1".to_owned());
        let waiting = store.waiting("1").unwrap();
        assert_eq!(waiting.token, "token-1");
        assert!(!waiting.deferred);
        store.set_deferred("1", true);
        assert!(store.waiting("1").unwrap().deferred);
        store.forget("1");
        assert!(store.waiting("1").is_none());
        assert!(store.waiting("unknown").is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn a_token_expires_before_discord_stops_accepting_it() {
        let store = Interactions::default();
        store.insert("1".to_owned(), "token".to_owned());
        tokio::time::advance(LIFETIME - Duration::from_secs(1)).await;
        assert!(store.waiting("1").is_some());
        tokio::time::advance(Duration::from_secs(2)).await;
        assert!(store.waiting("1").is_none());
        // Inserting another one clears the expired entry.
        store.insert("2".to_owned(), "token".to_owned());
        assert_eq!(store.len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn the_store_does_not_grow_past_its_capacity() {
        let store = Interactions::default();
        for n in 0..CAPACITY + 10 {
            store.insert(n.to_string(), "token".to_owned());
            tokio::time::advance(Duration::from_millis(1)).await;
        }
        assert_eq!(store.len(), CAPACITY);
        // The oldest were the ones dropped.
        assert!(store.waiting("0").is_none());
        assert!(store.waiting(&(CAPACITY + 9).to_string()).is_some());
    }

    #[test]
    fn the_debug_output_has_no_token() {
        let store = Interactions::default();
        store.insert("1".to_owned(), "secret-token".to_owned());
        assert!(!format!("{store:?}").contains("secret-token"));
    }
}
