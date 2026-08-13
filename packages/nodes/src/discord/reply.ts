import { joinStatements, type NodeDefinition } from "../definition.js"

/**
 * Answers the interaction that started the run. `content` reads from its Wire
 * when one is connected, and from the text typed into the Node otherwise.
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
      id: "content",
      kind: "data",
      direction: "input",
      dataType: "string",
      labelKey: "nodes.discord.interaction.reply.ports.content.label"
    }
  ],
  fields: [
    {
      id: "content",
      labelKey: "nodes.discord.interaction.reply.fields.content.label",
      control: "text",
      defaultValue: ""
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
      `content: ${context.input("content")}`,
      `ephemeral: ${context.literal(context.field("ephemeral"))}`
    ].join(", ")

    return joinStatements([
      context.trace({ kind: "node-entered" }),
      `await ${context.runtime}.discord.reply(${context.event}, { ${options} })`,
      context.continuation("next")
    ])
  }
}
