/**
 * The Embed the generated code builds and sends. It is a value of its own —
 * one Node builds it, Reply sends it — and it is never text: nothing coerces
 * an Embed into a message line.
 *
 * What is held here is our own vocabulary, `colour` included. Discord's
 * spelling, and everything else its API asks for, is arrived at at the
 * discord.js boundary and nowhere else.
 *
 * Discord's limits are checked here and nowhere else. The editor calls
 * `checkEmbed` while the user types and again before the Run starts, and the
 * generated code reaches it through `embeds.build`, so a bot that was allowed
 * to run here behaves the same when it is self-hosted.
 */

/**
 * What Discord refuses an Embed for being longer than, and how many parts it
 * accepts. `total` is counted across the parts Discord counts: the title, the
 * description, the author's name, the footer's text and both halves of every
 * Embed Field. A link, a picture and the colour are not text and count for
 * nothing.
 */
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  authorName: 256,
  footerText: 2048,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFields: 25,
  total: 6000
} as const

/** The part of an Embed a length is measured against. */
export type EmbedPart =
  | "title"
  | "description"
  | "authorName"
  | "footerText"
  | "embedFieldName"
  | "embedFieldValue"
  | "total"

/**
 * Something about an Embed that Discord would refuse it for. It is a value
 * rather than a sentence because both readers of it say it in their own words:
 * the editor translates it, and the generated code says it in English down the
 * Failure Port.
 */
export type EmbedProblem =
  | {
      kind: "too-long"
      part: EmbedPart
      /** Which Embed Field it is, counted from one, when the part is one of theirs. */
      index?: number
      limit: number
      length: number
    }
  | { kind: "too-many-embed-fields"; limit: number; count: number }
  /** An Embed with nothing in it: Discord draws nothing and refuses the message. */
  | { kind: "empty" }

/** What the Runtime stops a run with when the Embed it was asked to send is invalid. */
export class EmbedError extends Error {
  constructor(readonly problem: EmbedProblem) {
    super(describeEmbedProblem(problem))
    this.name = "EmbedError"
  }
}

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

/**
 * The builder generated code calls. It normalises what the Node was given and
 * then refuses an Embed Discord would refuse, so that a value that arrived
 * along a Wire and turned out too long stops the run with a sentence a person
 * can read rather than reaching Discord and coming back as a `400`.
 *
 * A run that is stopped this way leaves the Node by its Failure Port; a Failure
 * Port nobody connected ends the Flow and records the reason.
 */
export const embeds: Embeds = {
  build(input) {
    const embed = buildEmbed(input)

    const [problem] = checkEmbed(embed)
    if (problem !== undefined) throw new EmbedError(problem)

    return embed
  }
}

/**
 * The Embed the input describes, normalised but unchecked: whole text, not cut
 * to any limit, so that whoever checks it can say how much too long it is.
 *
 * The editor builds one of these out of what is typed into the Embed Node, so
 * that what it checks and what the bot sends are the same value.
 */
export function buildEmbed(input: EmbedInput): Embed {
  const embed: Embed = {}

  const title = text(input.title)
  if (title !== undefined) embed.title = title

  // A link on a title nobody typed has nothing to lead from, and Discord
  // draws nothing for it either.
  const url = title === undefined ? undefined : link(input.url)
  if (url !== undefined) embed.url = url

  const description = text(input.description)
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

/**
 * The author line, which Discord only draws when it has a name: a link and an
 * icon are decorations of the name, so without one there is no line for them
 * to decorate and the whole author is left out.
 */
function authorOf(input: EmbedInput): EmbedAuthor | undefined {
  const name = text(input.authorName)
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
  const footerText = text(input.footerText)
  if (footerText === undefined) return undefined

  const footer: EmbedFooter = { text: footerText }
  const icon = link(input.footerIcon)
  if (icon !== undefined) footer.icon = icon
  return footer
}

/**
 * The Embed Fields that can be sent.
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
    const name = text(written.name)
    const fieldValue = text(written.value)
    if (name === undefined || fieldValue === undefined) continue

    embedFields.push({ name, value: fieldValue, inline: written.inline === true })
  }
  return embedFields
}

/**
 * One piece of an Embed's text, or nothing at all.
 *
 * An empty part is left out rather than sent empty: Discord draws a blank line
 * for a title of `""`, and an empty title is what an Embed whose title the user
 * never typed has. Nothing is cut here — an over-long part is a problem the
 * user is told about, not one this quietly hides.
 */
function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const rendered = typeof value === "string" ? value : String(value)
  return rendered.length === 0 ? undefined : rendered
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

/**
 * Everything about an Embed that Discord would refuse it for, in the order a
 * person would meet them: what is too long first, then what there is too much
 * of, then the Embed that says nothing at all.
 *
 * This is the one place the limits are applied. The editor calls it while the
 * user types and again before the Run starts; the generated code reaches it
 * through `embeds.build`. There is no second reading of Discord's rules for
 * the two to disagree about.
 */
export function checkEmbed(embed: Embed): readonly EmbedProblem[] {
  const problems: EmbedProblem[] = []

  const measure = (part: EmbedPart, value: string | undefined, index?: number) => {
    const limit = EMBED_LIMITS[part]
    if (value === undefined || value.length <= limit) return
    problems.push({ kind: "too-long", part, index, limit, length: value.length })
  }

  measure("title", embed.title)
  measure("description", embed.description)
  measure("authorName", embed.author?.name)
  measure("footerText", embed.footer?.text)

  const embedFields = embed.embedFields ?? []
  embedFields.forEach((embedField, at) => {
    // The pairs are counted from one, because that is how the user counts the
    // rows they laid out on the Node.
    measure("embedFieldName", embedField.name, at + 1)
    measure("embedFieldValue", embedField.value, at + 1)
  })

  const total = embedLength(embed)
  if (total > EMBED_LIMITS.total) {
    problems.push({ kind: "too-long", part: "total", limit: EMBED_LIMITS.total, length: total })
  }

  if (embedFields.length > EMBED_LIMITS.embedFields) {
    problems.push({
      kind: "too-many-embed-fields",
      limit: EMBED_LIMITS.embedFields,
      count: embedFields.length
    })
  }

  if (isEmptyEmbed(embed)) problems.push({ kind: "empty" })

  return problems
}

/**
 * How much of Discord's budget for one Embed this one spends: every part it
 * counts, added up. A colour, a link and a picture are not text and spend
 * nothing.
 */
export function embedLength(embed: Embed): number {
  const embedFields = (embed.embedFields ?? []).reduce(
    (spent, embedField) => spent + embedField.name.length + embedField.value.length,
    0
  )

  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    embedFields
  )
}

/**
 * Whether Discord has nothing to draw. A colour bar and a timestamp are
 * decorations of an Embed's content rather than content of their own, so an
 * Embed carrying only those is a message Discord refuses.
 */
function isEmptyEmbed(embed: Embed): boolean {
  return (
    embed.title === undefined &&
    embed.description === undefined &&
    embed.author === undefined &&
    embed.footer === undefined &&
    embed.image === undefined &&
    embed.thumbnail === undefined &&
    (embed.embedFields ?? []).length === 0
  )
}

/**
 * A problem in English, which is what the generated code says down the Failure
 * Port. The editor says the same problem in the user's own language: this is
 * for the bot, running on somebody's machine, with nothing to translate with.
 */
export function describeEmbedProblem(problem: EmbedProblem): string {
  switch (problem.kind) {
    case "empty":
      return "the embed has nothing in it: give it a title, a description, a picture or a pair"
    case "too-many-embed-fields":
      return `the embed has ${problem.count} pairs, and Discord allows ${problem.limit}`
    case "too-long": {
      const where = problem.index === undefined ? "" : ` of pair ${problem.index}`
      return `the embed's ${EMBED_PART_NAMES[problem.part]}${where} is ${problem.length} characters long, and Discord allows ${problem.limit}`
    }
  }
}

/** What each part is called in the sentence a stopped run reports. */
const EMBED_PART_NAMES: Record<EmbedPart, string> = {
  title: "title",
  description: "description",
  authorName: "author name",
  footerText: "footer",
  embedFieldName: "name",
  embedFieldValue: "value",
  total: "text, all of it together,"
}
