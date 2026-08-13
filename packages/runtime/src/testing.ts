import { coercions } from "./coercions.js"
import type {
  DiscordUser,
  ReplyOptions,
  SlashCommandDefinition,
  SlashCommandEvent,
  SlashCommandHandler
} from "./discord.js"
import type { FlowFailure, Runtime, TraceEvent } from "./runtime.js"

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
    reportFailure(failure) {
      failures.push(failure)
    },
    trace(event) {
      traces.push(event)
    },
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
