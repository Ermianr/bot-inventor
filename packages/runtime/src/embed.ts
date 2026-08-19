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
const AUTHOR_NAME_LIMIT = 256
const FOOTER_TEXT_LIMIT = 2048
const EMBED_FIELD_NAME_LIMIT = 256
const EMBED_FIELD_VALUE_LIMIT = 1024

/** How many Embed Fields Discord accepts on one Embed. */
const EMBED_FIELD_LIMIT = 25

/** The widest colour Discord understands: a 24-bit RGB integer. */
const MAX_COLOUR = 0xffffff

/** The schemes Discord draws a linked or pictured Embed part for. */
const LINK_SCHEMES = new Set(["http:", "https:"])

/** Who the Embed is attributed to, drawn as a small line above the title. */
export type EmbedAuthor = {
  name: string
  url?: string
  icon?: string
}

/** The small line under the Embed, next to the timestamp when there is one. */
export type EmbedFooter = {
  text: string
  icon?: string
}

/**
 * One name-and-value pair inside the Embed, drawn on a line of its own or
 * beside its neighbours.
 */
export type EmbedField = {
  name: string
  value: string
  inline: boolean
}

/** A rich block, as the Runtime hands it to Discord. */
export type Embed = {
  title?: string
  /** Where the title leads when it is clicked. */
  url?: string
  description?: string
  colour?: number
  author?: EmbedAuthor
  /** The large picture under the Embed's text, by public URL. */
  image?: string
  /** The small picture in the Embed's corner, by public URL. */
  thumbnail?: string
  footer?: EmbedFooter
  /** The name-and-value pairs laid out inside it, in the order they were written. */
  embedFields?: readonly EmbedField[]
  /** The instant the Embed was stamped with, in ISO-8601, as Discord takes it. */
  timestamp?: string
}

/**
 * What a Node asks for an Embed with. Every part is optional and unchecked
 * because it comes from generated code reading fields and Wires: a Slot nobody
 * wired is empty text, and a colour a hand-edited Project holds may be
 * anything at all.
 *
 * It is flat where the Embed is nested, because a Node's fields are flat: the
 * author's three parts are three fields, and putting them together is this
 * builder's job rather than the generated code's.
 */
export type EmbedInput = {
  title?: unknown
  url?: unknown
  description?: unknown
  colour?: unknown
  authorName?: unknown
  authorUrl?: unknown
  authorIcon?: unknown
  image?: unknown
  thumbnail?: unknown
  footerText?: unknown
  footerIcon?: unknown
  /** The Embed Fields, as the Node's list field holds them. */
  embedFields?: unknown
  /** Whether to stamp the Embed with the time it was sent. */
  timestamp?: unknown
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

    // A link on a title nobody typed has nothing to lead from, and Discord
    // draws nothing for it either.
    const url = title === undefined ? undefined : link(input.url)
    if (url !== undefined) embed.url = url

    const description = text(input.description, DESCRIPTION_LIMIT)
    if (description !== undefined) embed.description = description

    const colour = colourOf(input.colour)
    if (colour !== undefined) embed.colour = colour

    const author = authorOf(input)
    if (author !== undefined) embed.author = author

    const image = link(input.image)
    if (image !== undefined) embed.image = image

    const thumbnail = link(input.thumbnail)
    if (thumbnail !== undefined) embed.thumbnail = thumbnail

    const footer = footerOf(input)
    if (footer !== undefined) embed.footer = footer

    const embedFields = embedFieldsOf(input.embedFields)
    if (embedFields.length > 0) embed.embedFields = embedFields

    // The switch means "the time it was sent", so the instant is read here
    // rather than typed anywhere: an arbitrary date is not something the Embed
    // can be given.
    if (input.timestamp === true) embed.timestamp = new Date().toISOString()

    return embed
  }
}

/**
 * The author line, which Discord only draws when it has a name: a link and an
 * icon are decorations of the name, so without one there is no line for them
 * to decorate and the whole author is left out.
 */
function authorOf(input: EmbedInput): EmbedAuthor | undefined {
  const name = text(input.authorName, AUTHOR_NAME_LIMIT)
  if (name === undefined) return undefined

  const author: EmbedAuthor = { name }
  const url = link(input.authorUrl)
  if (url !== undefined) author.url = url
  const icon = link(input.authorIcon)
  if (icon !== undefined) author.icon = icon
  return author
}

/** The footer, left out whole when its text is missing, as the author is. */
function footerOf(input: EmbedInput): EmbedFooter | undefined {
  const footerText = text(input.footerText, FOOTER_TEXT_LIMIT)
  if (footerText === undefined) return undefined

  const footer: EmbedFooter = { text: footerText }
  const icon = link(input.footerIcon)
  if (icon !== undefined) footer.icon = icon
  return footer
}

/**
 * The Embed Fields that can be sent, at most as many as Discord accepts.
 *
 * Discord refuses the whole message over an Embed Field missing its name or
 * its value, so a pair the user only half wrote is left out and the ones
 * around it still reach the channel. What is left keeps the order it was
 * written in: that order is the layout.
 */
function embedFieldsOf(value: unknown): readonly EmbedField[] {
  if (!Array.isArray(value)) return []

  const embedFields: EmbedField[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue

    const written = entry as { name?: unknown; value?: unknown; inline?: unknown }
    const name = text(written.name, EMBED_FIELD_NAME_LIMIT)
    const fieldValue = text(written.value, EMBED_FIELD_VALUE_LIMIT)
    if (name === undefined || fieldValue === undefined) continue

    embedFields.push({ name, value: fieldValue, inline: written.inline === true })
    if (embedFields.length === EMBED_FIELD_LIMIT) break
  }
  return embedFields
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
 * A public URL, or nothing at all.
 *
 * Discord refuses the whole message when an Embed carries something that is
 * not a link where a link belongs, so a half-typed address takes the picture
 * it was meant for with it rather than the reply the user was expecting.
 */
function link(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const rendered = typeof value === "string" ? value : String(value)

  try {
    return LINK_SCHEMES.has(new URL(rendered).protocol) ? rendered : undefined
  } catch {
    return undefined
  }
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
