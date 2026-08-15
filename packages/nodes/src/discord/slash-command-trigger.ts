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
    const declared = context.field("parameters")
    const parameters = readCommandParameters(declared)
    const declaration = [
      `name: ${context.literal(context.field("name"))}`,
      `description: ${context.literal(context.field("description"))}`
    ]

    // What the user declared goes to the Runtime as they declared it, not as
    // this Node understood it. A parameter this build cannot make a Port of is
    // still a parameter they asked for, and registration is where it gets named
    // — dropping it here would register a command quietly asking for less than
    // the Canvas says it does.
    //
    // A command asking for nothing declares no parameters at all, rather than
    // an empty list Discord would have to be sent anyway.
    if (Array.isArray(declared) && declared.length > 0) {
      declaration.push(`parameters: ${context.literal(declared)}`)
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
  // The fallback is emitted for a required parameter too. Discord should always
  // send one, but "should" is doing the work there — a command registered
  // before the parameter was marked required is still rolling out somewhere —
  // and the cost of being wrong is `undefined` reaching a Discord message,
  // which is the outcome this table exists to prevent.
  const value = `${answered} ?? ${EMPTY_VALUE[parameter.type]}`

  return `const ${context.output(parameterPortId(parameter.name))} = ${value}`
}
