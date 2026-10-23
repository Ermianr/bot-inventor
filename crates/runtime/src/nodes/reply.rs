//! `discord.reply`: answers the interaction that started the run.

use serde_json::Value;

use crate::catalog::{FieldKind, FieldSpec, NodeRequires, NodeSpec, OutputSpec, PortSpec};
use crate::platform::{AllowedMentions, Delivery, Platform, Reply};

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
pub(super) async fn execute<P: Platform>(cx: &mut NodeCx<'_, P>) -> Result<Outcome, NodeError> {
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
    let delivery = if cx.run.responded {
        Delivery::FollowUp
    } else {
        Delivery::Response
    };
    let message_id = cx
        .platform
        .reply(Reply {
            interaction,
            content,
            ephemeral: cx.run.ephemeral,
            mentions: AllowedMentions::default(),
            delivery,
        })
        .await?;
    cx.run.responded = true;
    let mut outcome = Outcome::next();
    outcome
        .outputs
        .insert("message_id".to_owned(), Value::String(message_id));
    Ok(outcome)
}
