import {
  type CommandParameter,
  commandParameterPorts,
  parameterPortId,
  readCommandParameters
} from "../command-parameters.js"
import {
  type DataType,
  type GenerationContext,
  indent,
  joinStatements,
  type NodeDefinition
} from "../definition.js"

/**
 * The value a parameter's Port carries when the caller left an optional
 * parameter out. Whether they answered at all is on the event, keyed by name;
 * what the Port hands downstream is the empty value of its own type, so that a
 * Flow reading an unanswered parameter says nothing rather than "undefined".
 */
const EMPTY_VALUE: Record<DataType, string> = {
  text: '""',
  number: "0",
  boolean: "false",
  user: "null"
}

/**
 * The Trigger that starts a Flow when someone uses a slash command. It declares
 * the command with the Runtime and binds the caller, and what the caller
 * answered, so downstream Nodes can read them.
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
  dynamicPorts(fields) {
    return commandParameterPorts(fields.parameters)
  },
  generate(context) {
    const parameters = readCommandParameters(context.field("parameters"))
    const declaration = [
      `name: ${context.literal(context.field("name"))}`,
      `description: ${context.literal(context.field("description"))}`
    ]

    // A command asking for nothing declares no parameters at all, rather than
    // an empty list Discord would have to be sent anyway.
    if (parameters.length > 0) {
      declaration.push(`parameters: ${context.literal(parameters)}`)
    }

    const definition = declaration.join(", ")

    const body = [
      context.trace({ kind: "node-entered" }),
      `const ${context.output("user")} = ${context.event}.user`,
      ...parameters.map(parameter => bindParameter(context, parameter)),
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

/** Binds what the caller answered for one parameter to that parameter's Port. */
function bindParameter(context: GenerationContext, parameter: CommandParameter): string {
  const answered = `${context.event}.parameters[${context.literal(parameter.name)}]`
  // A required parameter is always there, so only an optional one needs the
  // fallback — and writing it only where it can happen keeps the exported
  // source readable, which is what a Node Project is for.
  const value = parameter.required ? answered : `${answered} ?? ${EMPTY_VALUE[parameter.type]}`

  return `const ${context.output(parameterPortId(parameter.name))} = ${value}`
}
