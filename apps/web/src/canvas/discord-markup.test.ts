import { literalText, type SlottedText } from "@bot-inventor/schema"
import { describe, expect, it } from "vitest"
import { type Block, formattedText, type Inline, plainText } from "@/canvas/discord-markup"

/**
 * What the preview paints, as a table of cases.
 *
 * The renderer is the half of the preview that can be read without a screen:
 * every claim the preview makes about Discord's formatting is a row here, and
 * the component is left with nothing to decide but how to draw the answer.
 */

/** One block's inline nodes, which is what most of these cases are about. */
function inlineOf(blocks: readonly Block[]): readonly Inline[] {
  const [block] = blocks
  if (block === undefined) return []
  if (block.kind === "paragraph" || block.kind === "heading") return block.content
  throw new Error(`the case rendered a ${block.kind}, not a paragraph`)
}

function inline(text: string): readonly Inline[] {
  return inlineOf(formattedText(literalText(text)))
}

const styled: readonly { name: string; written: string; rendered: Inline }[] = [
  {
    name: "bold",
    written: "**loud**",
    rendered: { kind: "bold", content: [{ kind: "text", text: "loud" }] }
  },
  {
    name: "italic with asterisks",
    written: "*soft*",
    rendered: { kind: "italic", content: [{ kind: "text", text: "soft" }] }
  },
  {
    name: "italic with underscores",
    written: "_soft_",
    rendered: { kind: "italic", content: [{ kind: "text", text: "soft" }] }
  },
  {
    name: "underline",
    written: "__under__",
    rendered: { kind: "underline", content: [{ kind: "text", text: "under" }] }
  },
  {
    name: "strikethrough",
    written: "~~gone~~",
    rendered: { kind: "strikethrough", content: [{ kind: "text", text: "gone" }] }
  },
  {
    name: "spoiler",
    written: "||secret||",
    rendered: { kind: "spoiler", content: [{ kind: "text", text: "secret" }] }
  },
  {
    name: "inline code",
    written: "`x = 1`",
    rendered: { kind: "code", text: "x = 1" }
  },
  {
    name: "a masked link",
    written: "[the rules](https://example.com)",
    rendered: {
      kind: "link",
      url: "https://example.com",
      content: [{ kind: "text", text: "the rules" }]
    }
  }
]

describe("the formatting Discord renders", () => {
  for (const { name, written, rendered } of styled) {
    it(`renders ${name}`, () => {
      expect(inline(written)).toEqual([rendered])
    })
  }

  it("nests one style inside another", () => {
    expect(inline("**loud and *soft***")).toEqual([
      {
        kind: "bold",
        content: [
          { kind: "text", text: "loud and " },
          { kind: "italic", content: [{ kind: "text", text: "soft" }] }
        ]
      }
    ])
  })

  it("leaves a marker nothing closes as the text it is", () => {
    expect(inline("2 ** 3")).toEqual([{ kind: "text", text: "2 ** 3" }])
  })

  it("takes no formatting from inside code", () => {
    expect(inline("`**loud**`")).toEqual([{ kind: "code", text: "**loud**" }])
  })

  it("writes an escaped marker as the character it escapes", () => {
    expect(inline("\\*not italic\\*")).toEqual([{ kind: "text", text: "*not italic*" }])
  })
})

const pills: readonly { name: string; written: string; shape: string }[] = [
  { name: "a member", written: "<@123>", shape: "mention" },
  { name: "a member the old way", written: "<@!123>", shape: "mention" },
  { name: "a role", written: "<@&123>", shape: "mention" },
  { name: "a channel", written: "<#123>", shape: "mention" },
  { name: "everyone", written: "@everyone", shape: "mention" },
  { name: "here", written: "@here", shape: "mention" },
  { name: "a custom emoji", written: "<:wave:123>", shape: "emoji" },
  { name: "an animated emoji", written: "<a:wave:123>", shape: "emoji" },
  { name: "a timestamp", written: "<t:1700000000>", shape: "timestamp" },
  { name: "a relative timestamp", written: "<t:1700000000:R>", shape: "timestamp" }
]

describe("what the editor cannot resolve", () => {
  for (const { name, written, shape } of pills) {
    it(`draws ${name} as a ${shape} pill`, () => {
      expect(inline(written)).toEqual([{ kind: "pill", shape }])
    })
  }

  it("leaves something merely angled as the text it is", () => {
    expect(inline("<not a mention>")).toEqual([{ kind: "text", text: "<not a mention>" }])
  })
})

describe("the blocks Discord lays out", () => {
  it("renders a heading of each level", () => {
    expect(formattedText(literalText("# One\n## Two\n### Three"))).toEqual([
      { kind: "heading", level: 1, content: [{ kind: "text", text: "One" }] },
      { kind: "heading", level: 2, content: [{ kind: "text", text: "Two" }] },
      { kind: "heading", level: 3, content: [{ kind: "text", text: "Three" }] }
    ])
  })

  it("renders a quote", () => {
    expect(formattedText(literalText("> quoted\n> still quoted"))).toEqual([
      {
        kind: "quote",
        content: [{ kind: "paragraph", content: [{ kind: "text", text: "quoted\nstill quoted" }] }]
      }
    ])
  })

  it("renders a bulleted list, nesting by how far it is indented", () => {
    expect(formattedText(literalText("- one\n- two\n  - deeper"))).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { depth: 0, content: [{ kind: "text", text: "one" }] },
          { depth: 0, content: [{ kind: "text", text: "two" }] },
          { depth: 1, content: [{ kind: "text", text: "deeper" }] }
        ]
      }
    ])
  })

  it("renders a numbered list", () => {
    expect(formattedText(literalText("1. one\n2. two"))).toEqual([
      {
        kind: "list",
        ordered: true,
        items: [
          { depth: 0, content: [{ kind: "text", text: "one" }] },
          { depth: 0, content: [{ kind: "text", text: "two" }] }
        ]
      }
    ])
  })

  it("renders a code block and the language it names", () => {
    expect(formattedText(literalText("```js\nconst a = 1\n```"))).toEqual([
      { kind: "codeBlock", language: "js", content: [{ kind: "text", text: "const a = 1" }] }
    ])
  })

  it("renders a code block nobody named a language for", () => {
    expect(formattedText(literalText("```\nplain\n```"))).toEqual([
      { kind: "codeBlock", language: undefined, content: [{ kind: "text", text: "plain" }] }
    ])
  })

  it("takes no formatting from inside a code block", () => {
    expect(formattedText(literalText("```\n# not a heading\n```"))).toEqual([
      {
        kind: "codeBlock",
        language: undefined,
        content: [{ kind: "text", text: "# not a heading" }]
      }
    ])
  })

  it("keeps a paragraph's own line breaks", () => {
    expect(formattedText(literalText("one\ntwo"))).toEqual([
      { kind: "paragraph", content: [{ kind: "text", text: "one\ntwo" }] }
    ])
  })

  it("renders nothing at all for text nobody wrote", () => {
    expect(formattedText([])).toEqual([])
  })
})

const withSlot: SlottedText = [
  { kind: "literal", text: "Who: " },
  { kind: "slot", slot: "slot-who" },
  { kind: "literal", text: "!" }
]

describe("a Slot inside the text", () => {
  it("is a node of its own, wherever it sits in the sentence", () => {
    expect(inlineOf(formattedText(withSlot))).toEqual([
      { kind: "text", text: "Who: " },
      { kind: "slot", slot: "slot-who" },
      { kind: "text", text: "!" }
    ])
  })

  it("does not join two halves of a marker into formatting", () => {
    expect(
      inlineOf(
        formattedText([
          { kind: "literal", text: "**loud " },
          { kind: "slot", slot: "slot-who" },
          { kind: "literal", text: "**" }
        ])
      )
    ).toEqual([
      { kind: "text", text: "**loud " },
      { kind: "slot", slot: "slot-who" },
      { kind: "text", text: "**" }
    ])
  })
})

describe("the parts Discord leaves unformatted", () => {
  it("writes the markers out as the characters they are", () => {
    expect(plainText(literalText("**loud** <@123>"))).toEqual([
      { kind: "text", text: "**loud** <@123>" }
    ])
  })

  it("still draws a Slot as a Slot, because nothing here knows its value", () => {
    expect(plainText(withSlot)).toEqual([
      { kind: "text", text: "Who: " },
      { kind: "slot", slot: "slot-who" },
      { kind: "text", text: "!" }
    ])
  })
})
