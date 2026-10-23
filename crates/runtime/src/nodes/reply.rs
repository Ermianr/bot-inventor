//! `discord.reply`: answers the interaction that started the run.

use std::sync::Arc;

use serde_json::Value;

use crate::catalog::{FieldKind, FieldSpec, NodeRequires, NodeSpec, OutputSpec, PortSpec};
use crate::platform::{AllowedMentions, Platform, Reply};
use crate::run::Stage;
use crate::storage::Storage;

use super::{NodeCx, NodeError, Outcome};

/// The most characters Discord accepts in a message.
const MAX_CONTENT_CHARS: usize = 2000;

pub(super) static SPEC: NodeSpec = NodeSpec {
    type_id: "discord.reply",
    version: 1,
    fields: &[FieldSpec {
        name: "content",
        kind: FieldKind::Text {
            min: 1,
            max: MAX_CONTENT_CHARS,
            template: true,
        },
        required: true,
    }],
    ports: &[PortSpec { name: "next" }, PortSpec { name: "error" }],
    outputs: &[OutputSpec { name: "message_id" }],
    requires: NodeRequires::NOTHING,
    trigger: None,
};

/// The first reply is the response to the interaction; the ones after it are follow-ups. The
/// message notifies nobody, and it is visible only to the user when the command says so.
pub(super) async fn execute<P: Platform, S: Storage>(
    cx: &mut NodeCx<'_, P, S>,
) -> Result<Outcome, NodeError> {
    let content = cx.text("content")?;
    let length = content.chars().count();
    if length == 0 || length > MAX_CONTENT_CHARS {
        return Err(NodeError::invalid(format!(
            "`content` must have 1 to {MAX_CONTENT_CHARS} characters once it is written"
        )));
    }
    let Some(interaction) = cx.run.interaction.clone() else {
        return Err(NodeError::invalid(
            "the event has no interaction to reply to",
        ));
    };
    // The lock is held while the message is sent, so the deferral timer cannot slip in between.
    let response = Arc::clone(&cx.run.response);
    let mut stage = response.lock().await;
    let message_id = cx
        .platform
        .reply(Reply {
            interaction,
            content,
            ephemeral: response.ephemeral(),
            mentions: AllowedMentions::default(),
            delivery: stage.delivery(),
        })
        .await?;
    *stage = Stage::Responded;
    drop(stage);
    let mut outcome = Outcome::next();
    outcome
        .outputs
        .insert("message_id".to_owned(), Value::String(message_id));
    Ok(outcome)
}
