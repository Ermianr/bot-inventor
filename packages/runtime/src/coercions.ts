import type { DiscordUser } from "./discord.js"

/**
 * The runtime half of a Coercion. The Compiler decides which Coercion a Wire
 * needs; these are the conversions it calls into, so the conversion is one
 * implementation rather than one per Node that happens to need it.
 */
export type Coercions = {
  /** A user rendered as the text a human expects to read. */
  userToText(user: DiscordUser): string
  numberToText(value: number): string
  booleanToText(value: boolean): string
}

export const coercions: Coercions = {
  userToText: user => user.displayName,
  numberToText: value => String(value),
  booleanToText: value => String(value)
}
