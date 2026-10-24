/** A small catalog and flow for tests, shaped like what `node_catalog` returns. */

import type { Flow, NodeSpec } from "../lib/bindings";

const nothing = { intents: [], cache: [] };

export const trigger: NodeSpec = {
  type_id: "discord.slash_command",
  version: 1,
  fields: [
    {
      name: "name",
      kind: { type: "Text", value: { min: 1, max: 32, template: false } },
      required: true,
    },
    { name: "ephemeral", kind: { type: "Boolean" }, required: true },
  ],
  ports: [{ name: "next" }],
  outputs: [],
  requires: nothing,
  trigger: {
    event: "slash_command",
    command: true,
    fields: ["user.id"],
    options_field: "options",
  },
};

export const reply: NodeSpec = {
  type_id: "discord.reply",
  version: 1,
  fields: [
    {
      name: "content",
      kind: { type: "Text", value: { min: 1, max: 2000, template: true } },
      required: true,
    },
  ],
  ports: [{ name: "next" }, { name: "error" }],
  outputs: [{ name: "message_id" }],
  requires: nothing,
  trigger: null,
};

export const branch: NodeSpec = {
  type_id: "logic.branch",
  version: 1,
  fields: [
    { name: "condition", kind: { type: "Expression" }, required: true },
    {
      name: "mode",
      kind: { type: "Choice", value: ["all", "any"] },
      required: true,
    },
    {
      name: "items",
      kind: { type: "List", value: { max: 3, item: [] } },
      required: true,
    },
  ],
  ports: [{ name: "true" }, { name: "false" }, { name: "error" }],
  outputs: [],
  requires: nothing,
  trigger: null,
};

export const catalog: readonly NodeSpec[] = [trigger, reply, branch];

/** Ping: a command that replies. */
export const ping: Flow = {
  nodes: [
    {
      id: "n1",
      alias: "ping_command",
      type: "discord.slash_command",
      type_version: 1,
      settings: { name: "ping", ephemeral: false },
      editor: { x: 0, y: 0 },
    },
    {
      id: "n2",
      alias: "reply",
      type: "discord.reply",
      type_version: 1,
      settings: { content: "Pong!" },
      editor: { x: 280, y: 0 },
    },
  ],
  lines: [{ from: { node: "n1", port: "next" }, to: "n2" }],
};
