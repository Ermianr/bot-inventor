import type { DiscordUser } from "./discord.js"

/**
 * The runtime half of a Coercion. The Compiler decides which Coercion a Wire
 * needs; these are the conversions it calls into, so the conversion is one
 * implementation rather than one per Node that happens to need it.
 */
export type Coercions = {
  /**
   * A user rendered as a mention. Discord turns `<@id>` into the name the
   * reader knows them by and pings them, which is what someone dropping a user
   * into a message expects — a plain display name would neither.
   */
  userToText(user: DiscordUser): string
}

export const coercions: Coercions = {
  userToText: user => `<@${user.id}>`
}
