import type { ChatInputCommandInteraction, Client, InteractionReplyOptions } from "discord.js"
import { coercions } from "./coercions.js"
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

  const client: Client = new Client({ intents: [GatewayIntentBits.Guilds] })
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

      if (options.guildId === undefined) {
        await readyClient.application.commands.set(definitions)
      } else {
        await readyClient.application.commands.set(definitions, options.guildId)
      }
    },
    async stop() {
      await client.destroy()
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
