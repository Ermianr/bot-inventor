import { coercions } from "./coercions.js"
import type {
  CommandPayload,
  DiscordCommandApi,
  RegisteredCommand,
  RegistrationTarget
} from "./command-registration.js"
import type {
  DiscordUser,
  ReplyOptions,
  SlashCommandDefinition,
  SlashCommandEvent,
  SlashCommandHandler
} from "./discord.js"
import type { FlowFailure, Runtime, TraceEvent } from "./runtime.js"
import { createTracing } from "./tracing.js"

/**
 * A call the bot made to Discord. Tests assert on these rather than on the
 * generated source, so a change in how code is emitted does not break them.
 */
export type RecordedCall =
  | { method: "registerSlashCommand"; definition: SlashCommandDefinition }
  | { method: "reply"; commandName: string; content: string; ephemeral: boolean }

/** One simulated use of a slash command. */
export type SlashCommandInput = {
  command: string
  user?: Partial<DiscordUser>
  guildId?: string | null
  channelId?: string
}

export type FakeRuntimeOptions = {
  /**
   * Makes a reply fail. Returning a message stands in for Discord refusing the
   * call — a missing permission, a deleted channel — and returning `undefined`
   * lets it through.
   */
  replyFails?: (event: SlashCommandEvent, options: ReplyOptions) => string | undefined
}

export type FakeRuntime = Runtime & {
  readonly calls: readonly RecordedCall[]
  readonly failures: readonly FlowFailure[]
  readonly traces: readonly TraceEvent[]
  /** The slash commands the compiled Project declared, in declaration order. */
  readonly commands: readonly string[]
  /** Runs the Flow registered for a command, as Discord would. */
  dispatchSlashCommand(input: SlashCommandInput): Promise<void>
}

/**
 * A stand-in for Discord's command endpoints, holding one set of commands per
 * target the way Discord does. It touches no network: registration is asserted
 * against what this ends up holding.
 */
export type FakeDiscordCommandApi = DiscordCommandApi & {
  /** What Discord would hold for a target right now. */
  commandsFor(target: RegistrationTarget): readonly CommandPayload[]
  /** Puts commands in place as though they had been registered earlier. */
  seed(target: RegistrationTarget, commands: readonly CommandPayload[]): void
  /** Every call made, so a test can tell a guild request from a global one. */
  readonly requests: readonly { method: "list" | "put"; target: RegistrationTarget }[]
}

export function createFakeDiscordCommandApi(): FakeDiscordCommandApi {
  const stored = new Map<string, CommandPayload[]>()
  const requests: { method: "list" | "put"; target: RegistrationTarget }[] = []

  const keyOf = (target: RegistrationTarget) =>
    target.kind === "global" ? "global" : `guild:${target.guildId}`

  const held = (target: RegistrationTarget) => stored.get(keyOf(target)) ?? []

  // Discord assigns an id per command per target; a test asserting on names
  // does not care what it is, only that it is stable across a listing.
  const identify = (target: RegistrationTarget, command: CommandPayload): RegisteredCommand => ({
    id: `${keyOf(target)}/${command.name}`,
    name: command.name
  })

  return {
    requests,
    commandsFor: target => [...held(target)],
    seed(target, commands) {
      stored.set(keyOf(target), [...commands])
    },
    async listCommands(target) {
      requests.push({ method: "list", target })
      return held(target).map(command => identify(target, command))
    },
    async putCommands(target, commands) {
      requests.push({ method: "put", target })
      // Discord's bulk overwrite replaces the whole set, which is what makes a
      // command dropped from the Project disappear.
      stored.set(keyOf(target), [...commands])
      return commands.map(command => identify(target, command))
    }
  }
}

const anonymous: DiscordUser = {
  id: "user-1",
  username: "tester",
  displayName: "Tester"
}

/**
 * A Runtime backed by nothing: no network, no token, no discord.js. It records
 * what the bot asked Discord to do and lets a test push events back in.
 */
export function createFakeRuntime(options: FakeRuntimeOptions = {}): FakeRuntime {
  const calls: RecordedCall[] = []
  const failures: FlowFailure[] = []
  const traces: TraceEvent[] = []
  const handlers = new Map<string, SlashCommandHandler>()
  const trace = (event: TraceEvent) => {
    traces.push(event)
  }

  return {
    calls,
    failures,
    traces,
    get commands() {
      return [...handlers.keys()]
    },
    discord: {
      registerSlashCommand(definition, handler) {
        if (handlers.has(definition.name)) {
          throw new Error(`the slash command "${definition.name}" was registered twice`)
        }
        handlers.set(definition.name, handler)
        calls.push({ method: "registerSlashCommand", definition })
      },
      async reply(event, replyOptions) {
        const failure = options.replyFails?.(event, replyOptions)
        if (failure !== undefined) throw new Error(failure)
        calls.push({
          method: "reply",
          commandName: event.commandName,
          content: replyOptions.content,
          ephemeral: replyOptions.ephemeral
        })
      }
    },
    coerce: coercions,
    ...createTracing(trace),
    reportFailure(failure) {
      failures.push(failure)
    },
    trace,
    async start() {},
    async stop() {},
    async dispatchSlashCommand(input) {
      const handler = handlers.get(input.command)
      if (handler === undefined) {
        throw new Error(
          `no Flow is registered for the slash command "${input.command}"; registered: ${[...handlers.keys()].join(", ") || "none"}`
        )
      }
      await handler({
        commandName: input.command,
        user: { ...anonymous, ...input.user },
        guildId: input.guildId === undefined ? "guild-1" : input.guildId,
        channelId: input.channelId ?? "channel-1",
        source: undefined
      })
    }
  }
}
