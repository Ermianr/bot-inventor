import { indent, joinStatements, type NodeDefinition } from "../definition.js"

/**
 * The Trigger that starts a Flow when someone uses a slash command. It declares
 * the command with the Runtime and binds the caller so downstream Nodes can
 * read it.
 */
export const slashCommandTrigger: NodeDefinition = {
  id: "discord.trigger.slashCommand",
  labelKey: "nodes.discord.trigger.slashCommand.label",
  descriptionKey: "nodes.discord.trigger.slashCommand.description",
  isTrigger: true,
  ports: [
    {
      id: "next",
      kind: "execution",
      direction: "output",
      labelKey: "ports.next.label"
    },
    {
      id: "user",
      kind: "data",
      direction: "output",
      dataType: "user",
      labelKey: "nodes.discord.trigger.slashCommand.ports.user.label"
    }
  ],
  fields: [
    {
      id: "name",
      labelKey: "nodes.discord.trigger.slashCommand.fields.name.label",
      control: "text",
      defaultValue: ""
    },
    {
      id: "description",
      labelKey: "nodes.discord.trigger.slashCommand.fields.description.label",
      control: "text",
      defaultValue: ""
    }
  ],
  generate(context) {
    const definition = [
      `name: ${context.literal(context.field("name"))}`,
      `description: ${context.literal(context.field("description"))}`
    ].join(", ")

    const body = [
      `const ${context.output("user")} = ${context.event}.user`,
      context.trace({ kind: "node-entered" }),
      context.trace({
        kind: "value-produced",
        port: "user",
        expression: context.output("user")
      }),
      context.continuation("next")
    ]

    return [
      `${context.runtime}.discord.registerSlashCommand({ ${definition} }, async ${context.event} => {`,
      indent(joinStatements(body)),
      "})"
    ].join("\n")
  }
}
