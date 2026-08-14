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
    },
    {
      id: "parameters",
      labelKey: "nodes.discord.trigger.slashCommand.fields.parameters.label",
      control: "commandParameters",
      defaultValue: []
    }
  ],
  generate(context) {
    const parameters = context.field("parameters")
    const declaration = [
      `name: ${context.literal(context.field("name"))}`,
      `description: ${context.literal(context.field("description"))}`
    ]

    // A command asking for nothing declares no parameters at all, rather than
    // an empty list Discord would have to be sent anyway.
    if (Array.isArray(parameters) && parameters.length > 0) {
      declaration.push(`parameters: ${context.literal(parameters)}`)
    }

    const definition = declaration.join(", ")

    const body = [
      context.trace({ kind: "node-entered" }),
      `const ${context.output("user")} = ${context.event}.user`,
      context.trace({ kind: "node-completed" }),
      context.continuation("next")
    ]

    return [
      `${context.runtime}.discord.registerSlashCommand({ ${definition} }, async ${context.event} => {`,
      indent(joinStatements(body)),
      "})"
    ].join("\n")
  }
}
