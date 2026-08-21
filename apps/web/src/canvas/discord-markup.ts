import type { SlottedText } from "@bot-inventor/schema"

/**
 * What a piece of text looks like once Discord has drawn it.
 *
 * Discord's formatting is close enough to Markdown to be mistaken for it and
 * different enough to be wrong about, so the preview does not guess: this is
 * one pure function from what the user typed to what the message will look
 * like, tested as a table of cases, and the preview is only what puts the
 * answer on screen.
 *
 * Two things it deliberately refuses to invent. A mention, a custom emoji and
 * a timestamp are drawn as a pill of the right shape and nothing else, because
 * the editor is not connected to Discord and cannot know whose name, which
 * picture or what hour they stand for. And a Slot is a node of its own, never
 * text: what a Wire carries is only known once the bot runs.
 */

/** A piece of text with nothing else inside it. */
export type MarkupText = { kind: "text"; text: string }

/** A hole in the sentence, drawn where its value will land (ADR 0010). */
export type MarkupSlot = { kind: "slot"; slot: string }

/** Something the editor cannot resolve, drawn as the shape it would have. */
export type MarkupPill = { kind: "pill"; shape: "mention" | "emoji" | "timestamp" }

/** Text Discord draws in a monospaced box, formatted by nothing. */
export type MarkupCode = { kind: "code"; text: string }

/** Words that point somewhere, written as `[label](url)`. */
export type MarkupLink = { kind: "link"; url: string; content: readonly Inline[] }

/** One of the styles that wrap other text rather than replacing it. */
export type StyleKind = "bold" | "italic" | "underline" | "strikethrough" | "spoiler"

export type MarkupStyle = { kind: StyleKind; content: readonly Inline[] }

export type Inline = MarkupText | MarkupSlot | MarkupPill | MarkupCode | MarkupLink | MarkupStyle

export type Block =
  | { kind: "paragraph"; content: readonly Inline[] }
  | { kind: "heading"; level: 1 | 2 | 3; content: readonly Inline[] }
  | { kind: "quote"; content: readonly Block[] }
  | { kind: "list"; ordered: boolean; items: readonly ListItem[] }
  | { kind: "codeBlock"; language: string | undefined; content: readonly Inline[] }

/** One line of a list, and how far in it sits. */
export type ListItem = { depth: number; content: readonly Inline[] }

/**
 * The text as Discord draws it, formatting and all. This is the description of
 * an Embed and the value of an Embed Field — the parts Discord actually
 * renders.
 */
export function formattedText(segments: SlottedText): readonly Block[] {
  return blocksOf(linesOf(segments))
}

/**
 * The same text where Discord renders none of it: the title of an Embed, its
 * footer, and the name of an Embed Field. Every marker is left standing as the
 * characters it is made of, because that is exactly what the user will see.
 *
 * A Slot is still a Slot here. It is not formatting — it is a value that has
 * not arrived yet — and there is nothing about the title that could resolve it.
 */
export function plainText(segments: SlottedText): readonly Inline[] {
  return piecesOf(segments).map(piece =>
    piece.kind === "slot" ? { kind: "slot", slot: piece.slot } : { kind: "text", text: piece.text }
  )
}

/**
 * A run of the sentence that formatting is allowed to be found in. A Slot cuts
 * the sentence in two: `**loud [value]**` is not bold, because the marker the
 * user opened is closed on the far side of a hole, and pretending otherwise
 * would have the preview render something Discord will not.
 */
type Piece = { kind: "text"; text: string } | { kind: "slot"; slot: string }

/** One line of the text, which is the unit every block is measured in. */
type Line = readonly Piece[]

/** The pieces of a whole field, with the ones that touch joined into one. */
function piecesOf(segments: SlottedText): readonly Piece[] {
  const pieces: Piece[] = []
  for (const segment of segments) {
    if (segment.kind === "slot") {
      pieces.push({ kind: "slot", slot: segment.slot })
      continue
    }
    if (segment.text.length === 0) continue

    const last = pieces.at(-1)
    if (last?.kind === "text")
      pieces[pieces.length - 1] = { kind: "text", text: last.text + segment.text }
    else pieces.push({ kind: "text", text: segment.text })
  }
  return pieces
}

/** The text cut into lines, each holding the pieces that fall on it. */
function linesOf(segments: SlottedText): readonly Line[] {
  const lines: Piece[][] = [[]]
  const push = (piece: Piece) => lines[lines.length - 1]?.push(piece)

  for (const piece of piecesOf(segments)) {
    if (piece.kind === "slot") {
      push(piece)
      continue
    }
    const parts = piece.text.split("\n")
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part.length > 0) push({ kind: "text", text: part })
    })
  }

  return lines.length === 1 && lines[0]?.length === 0 ? [] : lines
}

/** What one line begins with, which is what says which block it opens. */
function opening(line: Line): string {
  const [first] = line
  return first?.kind === "text" ? first.text : ""
}

/** The same line without the marker that opened its block. */
function withoutOpening(line: Line, length: number): Line {
  const [first, ...rest] = line
  if (first?.kind !== "text") return line
  const text = first.text.slice(length)
  return text.length === 0 ? rest : [{ kind: "text", text }, ...rest]
}

const HEADING = /^(#{1,3}) +/
const QUOTE = /^> ?/
const BULLET = /^( *)[-*] +/
const NUMBER = /^( *)\d+\. +/
const FENCE = /^```([A-Za-z0-9+#-]*) *$/

function blocksOf(lines: readonly Line[]): readonly Block[] {
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined) break
    const start = opening(line)

    const fence = FENCE.exec(start)
    if (fence !== null) {
      const closing = lines.findIndex(
        (candidate, at) => at > index && /^``` *$/.test(opening(candidate))
      )
      const end = closing === -1 ? lines.length : closing
      blocks.push({
        kind: "codeBlock",
        language: fence[1] === undefined || fence[1].length === 0 ? undefined : fence[1],
        content: inlineOf(joinLines(lines.slice(index + 1, end)), { formatted: false })
      })
      index = end + 1
      continue
    }

    const heading = HEADING.exec(start)
    if (heading?.[1] !== undefined) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        content: inlineOf(withoutOpening(line, heading[0].length))
      })
      index += 1
      continue
    }

    if (QUOTE.test(start)) {
      const quoted: Line[] = []
      while (index < lines.length) {
        const candidate = lines[index]
        if (candidate === undefined) break
        const marker = QUOTE.exec(opening(candidate))
        if (marker === null) break
        quoted.push(withoutOpening(candidate, marker[0].length))
        index += 1
      }
      blocks.push({ kind: "quote", content: blocksOf(quoted) })
      continue
    }

    const bullet = BULLET.exec(start)
    const number = NUMBER.exec(start)
    if (bullet !== null || number !== null) {
      const ordered = bullet === null
      const items: ListItem[] = []
      while (index < lines.length) {
        const candidate = lines[index]
        if (candidate === undefined) break
        const marker = (ordered ? NUMBER : BULLET).exec(opening(candidate))
        if (marker === null) break
        items.push({
          // Two spaces is one step in, which is how Discord's own client reads
          // an indented list; anything deeper than that it flattens.
          depth: Math.min(Math.floor((marker[1]?.length ?? 0) / 2), 2),
          content: inlineOf(withoutOpening(candidate, marker[0].length))
        })
        index += 1
      }
      blocks.push({ kind: "list", ordered, items })
      continue
    }

    // Everything else is a paragraph, and it runs until a line that opens a
    // block of its own. Its own line breaks are kept: Discord breaks a message
    // where the user pressed Enter rather than where a Markdown reader would.
    const paragraph: Line[] = []
    while (index < lines.length) {
      const candidate = lines[index]
      if (candidate === undefined) break
      if (opensBlock(opening(candidate))) break
      paragraph.push(candidate)
      index += 1
    }
    blocks.push({ kind: "paragraph", content: inlineOf(joinLines(paragraph)) })
  }

  return blocks
}

/** Whether a line begins something that is not the paragraph being read. */
function opensBlock(start: string): boolean {
  return (
    HEADING.test(start) ||
    QUOTE.test(start) ||
    BULLET.test(start) ||
    NUMBER.test(start) ||
    FENCE.test(start)
  )
}

/** Several lines as one run of pieces, with the breaks between them kept. */
function joinLines(lines: readonly Line[]): Line {
  const pieces: Piece[] = []
  lines.forEach((line, index) => {
    if (index > 0) pieces.push({ kind: "text", text: "\n" })
    pieces.push(...line)
  })
  return joined(pieces)
}

/** Pieces of text that touch, read as the one piece they are. */
function joined(pieces: readonly Piece[]): Piece[] {
  const out: Piece[] = []
  for (const piece of pieces) {
    const last = out.at(-1)
    if (piece.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + piece.text }
    } else out.push(piece)
  }
  return out
}

/**
 * One line — or one paragraph of them — as the nodes it draws as. Each run of
 * text is read on its own, so a Slot between two of them can neither be
 * formatted nor formatting.
 */
function inlineOf(line: Line, options: { formatted: boolean } = { formatted: true }): Inline[] {
  return joined(line).flatMap<Inline>(piece =>
    piece.kind === "slot"
      ? [{ kind: "slot", slot: piece.slot }]
      : options.formatted
        ? nodesOf(piece.text)
        : [{ kind: "text", text: piece.text }]
  )
}

/** The markers that wrap text, longest first so `**` is never read as `*`. */
const STYLES: readonly { delimiter: string; kind: StyleKind }[] = [
  { delimiter: "**", kind: "bold" },
  { delimiter: "__", kind: "underline" },
  { delimiter: "~~", kind: "strikethrough" },
  { delimiter: "||", kind: "spoiler" },
  { delimiter: "*", kind: "italic" },
  { delimiter: "_", kind: "italic" }
]

/** What a backslash may stand in front of, which is every marker's first character. */
const ESCAPABLE = new Set("*_~|`\\[]()#->")

const PILLS: readonly { pattern: RegExp; shape: MarkupPill["shape"] }[] = [
  { pattern: /^<@[!&]?\d+>/, shape: "mention" },
  { pattern: /^<#\d+>/, shape: "mention" },
  { pattern: /^@(everyone|here)\b/, shape: "mention" },
  { pattern: /^<a?:\w+:\d+>/, shape: "emoji" },
  { pattern: /^<t:-?\d+(:[tTdDfFR])?>/, shape: "timestamp" }
]

const CODE = /^`([^`\n]+)`/
const LINK = /^\[([^\]\n]*)\]\(([^)\s]+)\)/

/** A style being read, and what has been read inside it so far. */
type Frame = { delimiter: string; kind: StyleKind | undefined; nodes: Inline[] }

/**
 * One run of text as the nodes it draws as.
 *
 * The markers are read with a stack rather than by matching pairs from the
 * outside in, because that is what tells `**loud *soft***` from `**a** and
 * **b**`: a marker that matches the style being read closes it, and one that
 * does not opens a new one — but only if there is another of it further along
 * to close it, so `2 ** 3` stays the arithmetic it is.
 */
function nodesOf(text: string): Inline[] {
  const stack: Frame[] = [{ delimiter: "", kind: undefined, nodes: [] }]
  let plain = ""
  let index = 0

  const top = () => stack[stack.length - 1]
  const flush = () => {
    if (plain.length === 0) return
    top().nodes.push({ kind: "text", text: plain })
    plain = ""
  }
  const push = (node: Inline) => {
    flush()
    top().nodes.push(node)
  }

  while (index < text.length) {
    const rest = text.slice(index)

    const escaped = rest[1]
    if (rest.startsWith("\\") && escaped !== undefined && ESCAPABLE.has(escaped)) {
      plain += escaped
      index += 2
      continue
    }

    const pill = PILLS.find(candidate => candidate.pattern.test(rest))
    if (pill !== undefined) {
      const [matched] = pill.pattern.exec(rest) ?? []
      push({ kind: "pill", shape: pill.shape })
      index += matched?.length ?? 1
      continue
    }

    const code = CODE.exec(rest)
    if (code?.[1] !== undefined) {
      push({ kind: "code", text: code[1] })
      index += code[0].length
      continue
    }

    const link = LINK.exec(rest)
    if (link?.[1] !== undefined && link[2] !== undefined) {
      push({ kind: "link", url: link[2], content: nodesOf(link[1]) })
      index += link[0].length
      continue
    }

    // The style being read is closed by its own marker before anything else is
    // considered, so the last two asterisks of `*soft***` close the italic and
    // then the bold rather than opening a third style.
    const open = top()
    if (open.kind !== undefined && rest.startsWith(open.delimiter)) {
      flush()
      stack.pop()
      top().nodes.push({ kind: open.kind, content: open.nodes })
      index += open.delimiter.length
      continue
    }

    // A marker opens a style only if the same marker stands further along with
    // something between the two: `2 ** 3` is arithmetic, and the second half of
    // a marker whose first half a Slot cut off closes nothing.
    const style = STYLES.find(
      candidate =>
        rest.startsWith(candidate.delimiter) &&
        rest.slice(candidate.delimiter.length).indexOf(candidate.delimiter) > 0
    )
    if (style !== undefined) {
      flush()
      stack.push({ delimiter: style.delimiter, kind: style.kind, nodes: [] })
      index += style.delimiter.length
      continue
    }

    plain += text[index]
    index += 1
  }

  flush()

  // A style the text opened and never closed is not a style at all: its marker
  // goes back to being the characters it is made of, in front of what it holds.
  while (stack.length > 1) {
    const unclosed = stack.pop() as Frame
    top().nodes.push({ kind: "text", text: unclosed.delimiter }, ...unclosed.nodes)
  }

  return joinedNodes(top().nodes)
}

/** Text nodes that ended up beside each other, read as the one node they are. */
function joinedNodes(nodes: readonly Inline[]): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (node.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + node.text }
    } else out.push(node)
  }
  return out
}
