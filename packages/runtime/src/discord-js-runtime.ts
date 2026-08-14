import type { ChatInputCommandInteraction, Client, InteractionReplyOptions, REST } from "discord.js"
import { coercions } from "./coercions.js"
import {
  type DiscordCommandApi,
  type RegisteredCommand,
  type RegistrationResult,
  type RegistrationTarget,
  registerCommands
} from "./command-registration.js"
import type {
  DiscordRuntime,
  ReplyOptions,
  SlashCommandDefinition,
  SlashCommandEvent,
  SlashCommandHandler
} from "./discord.js"
import type { FlowFailure, Runtime, TraceEvent } from "./runtime.js"

export type DiscordRuntimeOptions = {
  /** The bot token. It comes from the OS keychain while editing and from the environment in an Export. */
  token: string
  /**
   * Restricts command registration to a single server. Development Mode uses
   * it because guild commands appear immediately, where global ones do not.
   */
  guildId?: string
  /**
   * The base URL of Discord's API. It exists so a bot can be pointed at a
   * proxy — and, in our own tests, at a fake Discord that an exported bundle
   * can be run against without a network. It defaults to `DISCORD_API_URL` from
   * the environment, and to Discord itself when that is unset, so that an
   * Export needs no option of its own to be redirected.
   */
  apiBaseUrl?: string
  /**
   * What registration did on start. Development Mode reports the deleted names
   * so a rename does not look like a command that vanished for no reason.
   */
  onCommandsRegistered?: (result: RegistrationResult) => void
  onFailure?: (failure: FlowFailure) => void
  onTrace?: (event: TraceEvent) => void
  /**
   * Something went wrong outside any Flow's own error handling. It defaults to
   * writing to the console because the alternative — an unhandled rejection —
   * takes the whole exported bot down.
   */
  onUnexpectedError?: (error: unknown) => void
}

/**
 * The real Runtime: a thin layer over discord.js. discord.js is imported
 * dynamically so that anything only needing the contract — a test, the
 * Compiler — never pays for loading it.
 */
export async function createDiscordRuntime(options: DiscordRuntimeOptions): Promise<Runtime> {
  if (options.token.length === 0) {
    throw new Error("A bot token is required to connect to Discord.")
  }

  const { Client, Events, GatewayIntentBits, MessageFlags } = await import("discord.js")

  // An empty variable is how an unset one is commonly written in a container or
  // a CI environment, and reading it as a base URL breaks the bot on a message
  // that names neither Discord nor the variable.
  const configuredApiBaseUrl = options.apiBaseUrl ?? process.env.DISCORD_API_URL
  const apiBaseUrl =
    configuredApiBaseUrl === undefined || configuredApiBaseUrl.length === 0
      ? undefined
      : configuredApiBaseUrl

  if (apiBaseUrl !== undefined) {
    // Every request carries the token, so sending them somewhere other than
    // Discord is worth saying out loud rather than doing quietly.
    console.warn(
      `Bot Inventor: talking to ${apiBaseUrl} instead of Discord, because DISCORD_API_URL is set.`
    )
  }

  const client: Client = new Client({
    intents: [GatewayIntentBits.Guilds],
    ...(apiBaseUrl === undefined ? {} : { rest: { api: apiBaseUrl } })
  })
  const definitions: SlashCommandDefinition[] = []
  const handlers = new Map<string, SlashCommandHandler>()
  const reportUnexpected =
    options.onUnexpectedError ??
    ((error: unknown) => {
      console.error("Bot Inventor: an error escaped a Flow.", error)
    })

  client.on(Events.InteractionCreate, interaction => {
    if (!interaction.isChatInputCommand()) return
    const handler = handlers.get(interaction.commandName)
    if (handler === undefined) return

    // A Flow reports its own failures; anything that escapes it must still not
    // become an unhandled rejection, which would end the process.
    handler(toSlashCommandEvent(interaction)).catch(reportUnexpected)
  })

  const discord: DiscordRuntime = {
    registerSlashCommand(definition, handler) {
      if (handlers.has(definition.name)) {
        throw new Error(
          `Two Flows both declare the slash command "${definition.name}". Discord allows one of each name.`
        )
      }
      definitions.push(definition)
      handlers.set(definition.name, handler)
    },
    async reply(event, replyOptions: ReplyOptions) {
      const interaction = event.source as ChatInputCommandInteraction
      const message: InteractionReplyOptions = { content: replyOptions.content }
      if (replyOptions.ephemeral) message.flags = MessageFlags.Ephemeral

      // An interaction is answered once; every Reply Node after the first in a
      // Flow sends a follow-up instead.
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(message)
        return
      }
      await interaction.reply(message)
    }
  }

  return {
    discord,
    coerce: coercions,
    reportFailure(failure) {
      options.onFailure?.(failure)
    },
    trace(event) {
      options.onTrace?.(event)
    },
    async start() {
      const ready = new Promise<Client<true>>(resolve => {
        client.once(Events.ClientReady, resolve)
      })
      await client.login(options.token)

      // `login` resolves when the gateway connection is up; the application is
      // only known once Discord has sent READY.
      const readyClient = await ready

      const target: RegistrationTarget =
        options.guildId === undefined
          ? { kind: "global" }
          : { kind: "guild", guildId: options.guildId }
      const api = createDiscordJsCommandApi(readyClient.rest, readyClient.application.id)

      // Registration is not the reporting callback's argument: an optional call
      // whose callee is absent never evaluates its arguments, which left an
      // exported bot — the one caller with nothing to report to — registering
      // no commands at all.
      const registration = await registerCommands(api, target, definitions)
      options.onCommandsRegistered?.(registration)
    },
    async stop() {
      await client.destroy()
    }
  }
}

/**
 * Command registration against the real Discord, over the REST client the
 * logged-in `Client` already carries. It only chooses the endpoint: which
 * commands go and which ones that leaves deleted is decided in
 * `registerCommands`, for both targets alike.
 */
function createDiscordJsCommandApi(rest: REST, applicationId: string): DiscordCommandApi {
  const route = (target: RegistrationTarget) =>
    target.kind === "global"
      ? `/applications/${applicationId}/commands`
      : `/applications/${applicationId}/guilds/${target.guildId}/commands`

  return {
    async listCommands(target) {
      return (await rest.get(route(target) as `/${string}`)) as RegisteredCommand[]
    },
    async putCommands(target, commands) {
      return (await rest.put(route(target) as `/${string}`, {
        body: commands
      })) as RegisteredCommand[]
    }
  }
}

function toSlashCommandEvent(interaction: ChatInputCommandInteraction): SlashCommandEvent {
  return {
    commandName: interaction.commandName,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName
    },
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    source: interaction
  }
}
