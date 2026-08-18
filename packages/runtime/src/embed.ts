/**
 * The Embed the generated code builds and sends. It is a value of its own —
 * one Node builds it, Reply sends it — and it is never text: nothing coerces
 * an Embed into a message line.
 *
 * What is held here is our own vocabulary, `colour` included. Discord's
 * spelling, and everything else its API asks for, is arrived at at the
 * discord.js boundary and nowhere else.
 */

/** What Discord refuses an Embed for being longer than. */
const TITLE_LIMIT = 256
const DESCRIPTION_LIMIT = 4096

/** The widest colour Discord understands: a 24-bit RGB integer. */
const MAX_COLOUR = 0xffffff

/** A rich block, as the Runtime hands it to Discord. */
export type Embed = {
  title?: string
  description?: string
  colour?: number
}

/**
 * What a Node asks for an Embed with. Every part is optional and unchecked
 * because it comes from generated code reading fields and Wires: a Slot nobody
 * wired is empty text, and a colour a hand-edited Project holds may be
 * anything at all.
 */
export type EmbedInput = {
  title?: unknown
  description?: unknown
  colour?: unknown
}

/** The embed builder generated code calls. */
export type Embeds = {
  build(input: EmbedInput): Embed
}

export const embeds: Embeds = {
  build(input) {
    const embed: Embed = {}

    const title = text(input.title, TITLE_LIMIT)
    if (title !== undefined) embed.title = title

    const description = text(input.description, DESCRIPTION_LIMIT)
    if (description !== undefined) embed.description = description

    const colour = colourOf(input.colour)
    if (colour !== undefined) embed.colour = colour

    return embed
  }
}

/**
 * One piece of an Embed's text, cut to the length Discord accepts.
 *
 * An empty part is left out rather than sent empty: Discord draws a blank line
 * for a title of `""`, and an empty title is what an Embed whose title the user
 * never typed has.
 */
function text(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined
  const rendered = typeof value === "string" ? value : String(value)
  if (rendered.length === 0) return undefined
  if (rendered.length <= limit) return rendered

  // Cutting between the two halves of a surrogate pair leaves a broken
  // character where an emoji was, so the pair goes rather than half of it.
  const cut = rendered.slice(0, limit)
  const last = cut.charCodeAt(limit - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/**
 * The colour bar down the Embed's side, as the 24-bit integer Discord takes.
 *
 * A value outside that range is brought back into it rather than dropped: the
 * colour control cannot produce one, so anything else arrived from a hand edit,
 * and an Embed with a strange bar tells the user more than no Embed at all.
 */
function colourOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(Math.max(Math.trunc(value), 0), MAX_COLOUR)
}
