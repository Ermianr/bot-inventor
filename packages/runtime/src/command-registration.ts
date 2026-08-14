import type { SlashCommandDefinition, SlashCommandParameter } from "./discord.js"

/**
 * Where a Project's commands are registered. Development Mode targets a single
 * test server because guild commands take effect immediately; an exported bot
 * targets `global`, which Discord rolls out on its own schedule.
 *
 * The two are the same registration code with a different target: nothing below
 * branches on which one it was given beyond choosing the endpoint.
 */
export type RegistrationTarget = { kind: "global" } | { kind: "guild"; guildId: string }

/**
 * Discord's numeric option types. Only the ones a Trigger can declare are
 * listed; the rest of Discord's table is not reachable from the Canvas.
 */
const OPTION_TYPE: Record<SlashCommandParameter["type"], number> = {
  text: 3,
  // 10 is Discord's NUMBER, not 4 (INTEGER): a Number field on the Canvas holds
  // a JavaScript number, so `1.5` has to be accepted.
  number: 10,
  boolean: 5,
  user: 6
}

/** One command option, in the shape Discord's API accepts. */
export type CommandOptionPayload = {
  type: number
  name: string
  description: string
  required: boolean
}

/** One command, in the shape Discord's API accepts. */
export type CommandPayload = {
  name: string
  description: string
  options: readonly CommandOptionPayload[]
}

/** A command as Discord reports it back. */
export type RegisteredCommand = {
  id: string
  name: string
}

/**
 * The slice of Discord's REST API command registration needs. It exists so the
 * registration can be driven by a fake endpoint in a test: nothing here knows
 * about discord.js, tokens or the network.
 */
export type DiscordCommandApi = {
  /** The commands Discord currently holds for a target. */
  listCommands(target: RegistrationTarget): Promise<readonly RegisteredCommand[]>
  /**
   * Replaces every command held for a target. Discord treats this as the
   * complete set, so a command left out of it stops existing.
   */
  putCommands(
    target: RegistrationTarget,
    commands: readonly CommandPayload[]
  ): Promise<readonly RegisteredCommand[]>
}

/** What a registration did, so Development Mode can report it to the user. */
export type RegistrationResult = {
  target: RegistrationTarget
  /** The command names the Project now has registered, in declaration order. */
  registered: readonly string[]
  /**
   * The commands Discord held that the Project no longer declares. A renamed
   * command shows up here under its previous name.
   */
  deleted: readonly string[]
}

/**
 * Registers a Project's commands against one target, and reports what a rename
 * or a deletion on the Canvas removed from Discord.
 *
 * The removal is not a separate pass: the replacement Discord's API performs is
 * what deletes them. Listing first only exists so the result can name them —
 * otherwise a rename would silently leave a ghost command the user cannot
 * explain, and this way we can at least tell them it went.
 */
export async function registerCommands(
  api: DiscordCommandApi,
  target: RegistrationTarget,
  definitions: readonly SlashCommandDefinition[]
): Promise<RegistrationResult> {
  // Built before anything is sent, so a parameter Discord would refuse stops
  // the registration here rather than half way through a bulk replacement.
  const payloads = definitions.map(toCommandPayload)
  const declared = new Set(payloads.map(command => command.name))

  // Listing only feeds the report of what a rename removed. Losing it must not
  // stop the registration itself, which is the part the bot cannot run without.
  const existing = await api.listCommands(target).catch(() => [])

  await api.putCommands(target, payloads)

  return {
    target,
    registered: payloads.map(command => command.name),
    deleted: existing.filter(command => !declared.has(command.name)).map(command => command.name)
  }
}

/**
 * Turns a Trigger's declaration into what Discord accepts. Name, description
 * and parameters all come from the Trigger Node's fields; nothing is invented
 * here.
 */
export function toCommandPayload(definition: SlashCommandDefinition): CommandPayload {
  const parameters = definition.parameters ?? []

  return {
    name: definition.name,
    description: definition.description,
    // Discord refuses a command whose required parameters follow optional ones.
    // The order they were listed in on the Canvas is the order they are asked
    // for, so this reorders rather than rejecting: parameters are named, and a
    // command the user cannot register is worse than one asking in a different
    // order than they typed.
    options: [...parameters]
      .sort((left, right) => Number(right.required) - Number(left.required))
      .map(parameter => ({
        type: optionTypeOf(parameter, definition),
        name: parameter.name,
        description: parameter.description,
        required: parameter.required
      }))
  }
}

/**
 * A Project is a file the user can have edited by hand or that an older build
 * wrote, so a parameter type this build does not know reaches here. Naming it
 * beats Discord answering the registration with a form error mentioning none of
 * the Canvas the user is looking at.
 */
function optionTypeOf(
  parameter: SlashCommandParameter,
  definition: SlashCommandDefinition
): number {
  const type = OPTION_TYPE[parameter.type]
  if (type === undefined) {
    throw new Error(
      `The parameter "${parameter.name}" of the slash command "${definition.name}" is of type "${parameter.type}", which is not a type a command can ask for.`
    )
  }
  return type
}
