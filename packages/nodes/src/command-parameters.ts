import type { FieldValue } from "@bot-inventor/schema"
import type { DataPortDefinition, DataType } from "./definition.js"

/**
 * The values a slash command asks its caller for, as the `commandParameters`
 * field holds them, and the Data output Ports they turn into.
 *
 * A parameter's declared type is a Data Port type, so the Coercion table alone
 * decides what a parameter can be wired into: there is no second table saying
 * what a command's answers may be used for.
 */

/**
 * The Data Port types a slash command can ask its caller for. It is the Port
 * types minus the ones Discord has no option for: an Embed is built by a Node,
 * never something a caller types alongside a command.
 */
export type ParameterType = Exclude<DataType, "embed">

/** One value the person using a slash command supplies alongside it. */
export type CommandParameter = {
  name: string
  description: string
  type: ParameterType
  /** Discord refuses a command whose required parameters follow optional ones. */
  required: boolean
}

const PARAMETER_TYPES: readonly ParameterType[] = ["text", "number", "boolean", "user"]

/**
 * The prefix a parameter's Port id carries. It keeps the ids the user's
 * parameter names produce out of the way of the Trigger's own Ports, so a
 * parameter called `user` does not quietly become the caller.
 */
const PORT_PREFIX = "parameter."

/** The Port a parameter of this name would be read from. */
export function parameterPortId(name: string): string {
  return `${PORT_PREFIX}${name}`
}

/**
 * The parameters a `commandParameters` field declares.
 *
 * A Project is a file that an older build wrote or that someone edited by hand,
 * so anything at all reaches here. Entries that are not parameters are dropped
 * rather than thrown over: the Compiler names what it cannot emit, and the
 * editor has to keep drawing a Node whose field is halfway through being typed.
 */
export function readCommandParameters(value: FieldValue | undefined): CommandParameter[] {
  if (!Array.isArray(value)) return []

  const parameters: CommandParameter[] = []
  const taken = new Set<string>()

  for (const entry of value) {
    const parameter = readParameter(entry)
    // Discord asks for each name once, and two Ports of one id would be two
    // Wires the editor cannot tell apart.
    if (parameter === undefined || taken.has(parameter.name)) continue
    taken.add(parameter.name)
    parameters.push(parameter)
  }
  return parameters
}

/** One Data output Port per parameter, carrying the type that parameter asks for. */
export function commandParameterPorts(
  value: FieldValue | undefined
): readonly DataPortDefinition[] {
  return readCommandParameters(value).map(parameter => ({
    id: parameterPortId(parameter.name),
    kind: "data",
    direction: "output",
    dataType: parameter.type,
    labelKey: "ports.commandParameter.label",
    // The user named it, in their own words: there is nothing to translate.
    label: parameter.name
  }))
}

function readParameter(entry: FieldValue): CommandParameter | undefined {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined

  const { name, description, type, required } = entry
  if (typeof name !== "string" || name.length === 0) return undefined
  if (typeof type !== "string" || !PARAMETER_TYPES.includes(type as ParameterType)) return undefined

  return {
    name,
    description: typeof description === "string" ? description : "",
    type: type as ParameterType,
    required: required === true
  }
}
