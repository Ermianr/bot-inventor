import { joinStatements, type NodeDefinition } from "../definition.js"

/**
 * Answers the interaction that started the run. Its message is a Slotted text
 * field: what the user typed, with a value arriving along a Wire wherever they
 * put a Slot (ADR 0010).
 *
 * An Embed wired into it is answered with instead of a line of text. The Embed
 * Port has no field behind it — an Embed is built by a Node, never typed in —
 * so whether one is wired is what decides which reply this sends.
 */
export const reply: NodeDefinition = {
  id: "discord.interaction.reply",
  labelKey: "nodes.discord.interaction.reply.label",
  descriptionKey: "nodes.discord.interaction.reply.description",
  isTrigger: false,
  ports: [
    { id: "in", kind: "execution", direction: "input", labelKey: "ports.in.label" },
    { id: "next", kind: "execution", direction: "output", labelKey: "ports.next.label" },
    {
      id: "embed",
      kind: "data",
      direction: "input",
      dataType: "embed",
      labelKey: "nodes.discord.interaction.reply.ports.embed.label"
    }
  ],
  fields: [
    {
      id: "content",
      labelKey: "nodes.discord.interaction.reply.fields.content.label",
      control: "slottedText",
      defaultValue: []
    },
    {
      id: "ephemeral",
      labelKey: "nodes.discord.interaction.reply.fields.ephemeral.label",
      control: "switch",
      defaultValue: false
    }
  ],
  generate(context) {
    const parts = [
      `content: ${context.slottedField("content")}`,
      `ephemeral: ${context.literal(context.field("ephemeral"))}`
    ]

    // An unwired Embed Port is not an empty Embed: it is a reply that says its
    // message as text, which is what Reply has always done.
    if (context.isWired("embed")) parts.push(`embed: ${context.input("embed")}`)

    const options = parts.join(", ")

    return joinStatements([
      context.trace({ kind: "node-entered" }),
      `await ${context.runtime}.discord.reply(${context.event}, { ${options} })`,
      context.trace({ kind: "node-completed" }),
      context.continuation("next")
    ])
  }
}
