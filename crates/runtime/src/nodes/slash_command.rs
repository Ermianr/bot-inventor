//! `discord.slash_command`: the trigger of a flow started by a slash command.

use crate::catalog::{FieldKind, FieldSpec, NodeRequires, NodeSpec, PortSpec, TriggerSpec};
use crate::platform::Platform;
use crate::storage::Storage;

use super::{NodeCx, NodeError, Outcome};

/// The kinds of option a slash command can take.
pub const OPTION_KINDS: &[&str] = &[
    "string", "integer", "number", "boolean", "user", "channel", "role",
];

static OPTION_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        name: "name",
        kind: FieldKind::Text {
            min: 1,
            max: 64,
            template: false,
        },
        required: true,
    },
    FieldSpec {
        name: "description",
        kind: FieldKind::Text {
            min: 1,
            max: 200,
            template: false,
        },
        required: true,
    },
    FieldSpec {
        name: "type",
        kind: FieldKind::Choice(OPTION_KINDS),
        required: true,
    },
    FieldSpec {
        name: "required",
        kind: FieldKind::Boolean,
        required: false,
    },
];

pub(super) static SPEC: NodeSpec = NodeSpec {
    type_id: "discord.slash_command",
    version: 1,
    fields: &[
        FieldSpec {
            name: "name",
            kind: FieldKind::Text {
                min: 1,
                max: 64,
                template: false,
            },
            required: true,
        },
        FieldSpec {
            name: "description",
            kind: FieldKind::Text {
                min: 1,
                max: 200,
                template: false,
            },
            required: true,
        },
        FieldSpec {
            name: "ephemeral",
            kind: FieldKind::Boolean,
            required: false,
        },
        FieldSpec {
            name: "options",
            kind: FieldKind::List {
                max: 64,
                item: OPTION_FIELDS,
            },
            required: false,
        },
    ],
    ports: &[PortSpec { name: "next" }],
    outputs: &[],
    requires: NodeRequires {
        intents: &["guilds"],
        cache: &[],
    },
    trigger: Some(TriggerSpec {
        event: "slash_command",
        command: true,
        fields: &[
            "command.name",
            "user.id",
            "user.name",
            "member.roles",
            "member.permissions",
            "guild.id",
            "channel.id",
            "timestamp",
        ],
        options_field: Some("options"),
    }),
};

/// Remembers whether the replies of this run are visible only to the user.
pub(super) fn execute<P: Platform, S: Storage>(
    cx: &mut NodeCx<'_, P, S>,
) -> Result<Outcome, NodeError> {
    let ephemeral = cx.flag("ephemeral", false)?;
    cx.run.response.set_ephemeral(ephemeral);
    Ok(Outcome::next())
}
