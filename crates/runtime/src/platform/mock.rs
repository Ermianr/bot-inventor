use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use super::{Interaction, Platform, PlatformError, Reply};

/// An action the mock carried out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Reply(Reply),
    Defer {
        interaction: Interaction,
        ephemeral: bool,
    },
}

/// A platform for tests: it records the actions it is given and fails or waits when told to.
#[derive(Debug, Default)]
pub struct MockPlatform {
    state: Mutex<State>,
}

#[derive(Debug, Default)]
struct State {
    actions: Vec<Action>,
    failures: VecDeque<PlatformError>,
    delay: Duration,
    sent: u64,
}

impl MockPlatform {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The actions carried out so far, in order.
    #[must_use]
    pub fn actions(&self) -> Vec<Action> {
        self.state().actions.clone()
    }

    /// Makes the next action fail with `error`. Calls queue up, one failure per action.
    pub fn fail_next(&self, error: PlatformError) {
        self.state().failures.push_back(error);
    }

    /// Makes every action wait this long before it is carried out.
    pub fn set_delay(&self, delay: Duration) {
        self.state().delay = delay;
    }

    async fn wait(&self) {
        let delay = self.state().delay;
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Platform for MockPlatform {
    async fn defer(&self, interaction: Interaction, ephemeral: bool) -> Result<(), PlatformError> {
        self.wait().await;
        let mut state = self.state();
        if let Some(error) = state.failures.pop_front() {
            return Err(error);
        }
        state.actions.push(Action::Defer {
            interaction,
            ephemeral,
        });
        Ok(())
    }

    async fn reply(&self, reply: Reply) -> Result<String, PlatformError> {
        self.wait().await;
        let mut state = self.state();
        if let Some(error) = state.failures.pop_front() {
            return Err(error);
        }
        state.sent += 1;
        let id = format!("mock-{}", state.sent);
        state.actions.push(Action::Reply(reply));
        Ok(id)
    }
}
