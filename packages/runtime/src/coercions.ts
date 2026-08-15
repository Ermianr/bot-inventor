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
  userToText(user: DiscordUser | null): string
  /**
   * A number as the person reading it would write it. It goes through the
   * platform's own formatting rather than a fixed number of decimals, because a
   * count and a rate are the same Data type here and neither may be rounded
   * into the other.
   */
  numberToText(value: number): string
  /**
   * A boolean as text. It is the JavaScript spelling on purpose: this reaches a
   * Discord message, and translating it belongs to the day a Flow can say what
   * true and false mean in its own words.
   */
  booleanToText(value: boolean): string
}

export const coercions: Coercions = {
  // A User Port carries null when an optional user parameter went unanswered,
  // and a message reading "<@undefined>" is worse than one saying nothing.
  userToText: user => (user === null ? "" : `<@${user.id}>`),
  numberToText: value => String(value),
  booleanToText: value => String(value)
}
