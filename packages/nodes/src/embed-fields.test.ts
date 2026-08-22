import { describe, expect, it } from "bun:test"

import { EMBED_LIMITS } from "@bot-inventor/runtime/embed"
import { literalText } from "@bot-inventor/schema"

import { readEmbedFields, writtenEmbedFields } from "./embed-fields.js"

describe("the Embed Fields a field holds", () => {
  it("reads a name, a value and the inline switch of each one, in order", () => {
    expect(
      readEmbedFields([
        { name: literalText("Rule 1"), value: literalText("Be kind"), inline: true },
        { name: literalText("Rule 2"), value: literalText("Be brief"), inline: false }
      ])
    ).toEqual([
      { name: literalText("Rule 1"), value: literalText("Be kind"), inline: true },
      { name: literalText("Rule 2"), value: literalText("Be brief"), inline: false }
    ])
  })

  it("reads a half-typed Embed Field as the empty text it is being typed into", () => {
    expect(readEmbedFields([{ name: literalText("Rule 1") }])).toEqual([
      { name: literalText("Rule 1"), value: [], inline: false }
    ])
  })

  it("drops what is not an Embed Field at all", () => {
    expect(readEmbedFields(["Rule 1", 7, null])).toEqual([])
    expect(readEmbedFields("Rule 1")).toEqual([])
    expect(readEmbedFields(undefined)).toEqual([])
  })

  it("keeps the pairs past the twenty-five Discord accepts, for the user to delete", () => {
    const written = Array.from({ length: EMBED_LIMITS.embedFields + 3 }, (_, index) => ({
      name: literalText(`Rule ${index}`),
      value: literalText("Be kind"),
      inline: false
    }))

    expect(readEmbedFields(written)).toHaveLength(EMBED_LIMITS.embedFields + 3)
  })

  it("hands the Compiler a name that does not read as text, rather than emptying it", () => {
    expect(writtenEmbedFields([{ name: "Rule 1", value: literalText("Be kind") }])).toEqual([
      { name: "Rule 1", value: literalText("Be kind"), inline: false }
    ])
    expect(readEmbedFields([{ name: "Rule 1", value: literalText("Be kind") }])).toEqual([
      { name: [], value: literalText("Be kind"), inline: false }
    ])
  })
})
