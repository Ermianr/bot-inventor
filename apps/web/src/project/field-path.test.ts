import { describe, expect, it } from "bun:test"

import { literalText } from "@bot-inventor/schema"

import {
  fieldPathId,
  fieldWithSlottedTextAt,
  readFieldPath,
  slottedTextAt
} from "@/project/field-path"

/**
 * The address of one piece of Slotted text on a Node. It exists because the
 * name and the value of an Embed Field are text a Wire can be dropped into and
 * are not fields of their own, and a drop arrives holding one string.
 */

const fields = {
  content: literalText("Hello!"),
  embedFields: [
    { name: literalText("Rule 1"), value: literalText("Be kind"), inline: false },
    { name: literalText("Rule 2"), value: literalText("Be brief"), inline: true }
  ]
}

describe("where a piece of Slotted text lives on a Node", () => {
  it("writes and reads back the half of a pair it points at", () => {
    const path = { field: "embedFields", embedField: { index: 1, part: "value" } } as const

    expect(fieldPathId(path)).toBe("embedFields.1.value")
    expect(readFieldPath("embedFields.1.value")).toEqual(path)
  })

  it("reads a field of its own as the field it is", () => {
    expect(fieldPathId({ field: "content" })).toBe("content")
    expect(readFieldPath("content")).toEqual({ field: "content" })
  })

  it("reads anything that is not an address as the plain field it looks like", () => {
    expect(readFieldPath("embedFields.one.name")).toEqual({ field: "embedFields.one.name" })
    expect(readFieldPath("embedFields.0.inline")).toEqual({ field: "embedFields.0.inline" })
  })

  it("finds the text at a path, whichever kind of field it is in", () => {
    expect(slottedTextAt(fields, readFieldPath("content"))).toEqual(literalText("Hello!"))
    expect(slottedTextAt(fields, readFieldPath("embedFields.0.name"))).toEqual(
      literalText("Rule 1")
    )
    expect(slottedTextAt(fields, readFieldPath("embedFields.9.name"))).toEqual([])
  })

  it("writes a pair's value back as the whole list, leaving the rest of it alone", () => {
    expect(
      fieldWithSlottedTextAt(fields, readFieldPath("embedFields.0.value"), literalText("Be nice"))
    ).toEqual([
      { name: literalText("Rule 1"), value: literalText("Be nice"), inline: false },
      { name: literalText("Rule 2"), value: literalText("Be brief"), inline: true }
    ])
  })

  it("writes a field of its own back as the text itself", () => {
    expect(fieldWithSlottedTextAt(fields, readFieldPath("content"), literalText("Bye"))).toEqual(
      literalText("Bye")
    )
  })
})
