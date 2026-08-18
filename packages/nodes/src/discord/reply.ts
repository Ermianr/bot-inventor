import { joinStatements, type NodeDefinition } from "../definition.js"

/**
 * Answers the interaction that started the run. Its message is a Slotted text
 * field: what the user typed, with a value arriving along a Wire wherever they
 * put a Slot (ADR 0010).
 */
export const reply: NodeDefinition = {
  id: "discord.interaction.reply",
  labelKey: "nodes.discord.interaction.reply.label",
  descriptionKey: "nodes.discord.interaction.reply.description",
  isTrigger: false,
  ports: [
    { id: "in", kind: "execution", direction: "input", labelKey: "ports.in.label" },
    { id: "next", kind: "execution", direction: "output", labelKey: "ports.next.label" }
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
    const options = [
      `content: ${context.slottedField("content")}`,
      `ephemeral: ${context.literal(context.field("ephemeral"))}`
    ].join(", ")

    return joinStatements([
      context.trace({ kind: "node-entered" }),
      `await ${context.runtime}.discord.reply(${context.event}, { ${options} })`,
      context.trace({ kind: "node-completed" }),
      context.continuation("next")
    ])
  }
}
