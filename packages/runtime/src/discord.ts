/**
 * The slice of Discord the generated code is allowed to see. Generated code
 * never imports discord.js: it receives one of these from the Runtime, which is
 * what lets a test drive a whole Project against a fake client.
 */

/** A Discord user, reduced to what Nodes can read from it. */
export type DiscordUser = {
  id: string
  username: string
  displayName: string
}

/** The declaration of a slash command, as a Trigger declares it. */
export type SlashCommandDefinition = {
  name: string
  description: string
}

/** One invocation of a slash command. */
export type SlashCommandEvent = {
  commandName: string
  user: DiscordUser
  guildId: string | null
  channelId: string
  /**
   * The library object this event came from. Generated code never reads it; it
   * is how the Runtime answers a reply on the right interaction.
   */
  source: unknown
}

export type SlashCommandHandler = (event: SlashCommandEvent) => Promise<void>

/** What a reply carries. */
export type ReplyOptions = {
  content: string
  ephemeral: boolean
}

/** Everything the generated code may ask Discord to do. */
export type DiscordRuntime = {
  /** Declares a slash command and the Flow that runs when it is used. */
  registerSlashCommand(definition: SlashCommandDefinition, handler: SlashCommandHandler): void
  /** Answers the interaction the event came from. */
  reply(event: SlashCommandEvent, options: ReplyOptions): Promise<void>
}
