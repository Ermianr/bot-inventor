//! The schemas of the nodes the app ships. Their executors arrive with the run loop.

use super::{FieldKind, FieldSpec, NodeRequires, NodeSpec, OutputSpec, PortSpec, TriggerSpec};

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

static SLASH_COMMAND: NodeSpec = NodeSpec {
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

static REPLY: NodeSpec = NodeSpec {
    type_id: "discord.reply",
    version: 1,
    fields: &[FieldSpec {
        name: "content",
        kind: FieldKind::Text {
            min: 1,
            max: 2000,
            template: true,
        },
        required: true,
    }],
    ports: &[PortSpec { name: "next" }, PortSpec { name: "error" }],
    outputs: &[OutputSpec { name: "message_id" }],
    requires: NodeRequires::NOTHING,
    trigger: None,
};

static BRANCH: NodeSpec = NodeSpec {
    type_id: "logic.branch",
    version: 1,
    fields: &[FieldSpec {
        name: "condition",
        kind: FieldKind::Expression,
        required: true,
    }],
    ports: &[
        PortSpec { name: "true" },
        PortSpec { name: "false" },
        PortSpec { name: "error" },
    ],
    outputs: &[],
    requires: NodeRequires::NOTHING,
    trigger: None,
};

/// The schemas the app ships, for [`Registry::builtin`](super::Registry::builtin).
#[must_use]
pub fn builtin_specs() -> &'static [&'static NodeSpec] {
    static SPECS: [&NodeSpec; 3] = [&SLASH_COMMAND, &REPLY, &BRANCH];
    &SPECS
}
