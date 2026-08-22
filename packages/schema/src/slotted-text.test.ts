import { describe, expect, it } from "bun:test"

import { literalText, readSlottedText, type SlottedText, slotIdsOf } from "./slotted-text.js"

const greeting: SlottedText = [
  { kind: "literal", text: "Hello " },
  { kind: "slot", slot: "slot-caller" },
  { kind: "literal", text: ", hello " },
  { kind: "slot", slot: "slot-caller" }
]

describe("readSlottedText", () => {
  it("reads a sequence of literals and Slots", () => {
    expect(readSlottedText(greeting)).toEqual(greeting)
  })

  it("reads what is not a sequence of segments as empty", () => {
    expect(readSlottedText("Hello")).toEqual([])
    expect(readSlottedText(undefined)).toEqual([])
    expect(readSlottedText([{ kind: "slot" }])).toEqual([])
    expect(readSlottedText([{ kind: "slot", slot: "" }])).toEqual([])
  })
})

describe("literalText", () => {
  it("holds one piece of text as a single literal segment", () => {
    expect(literalText("Hello!")).toEqual([{ kind: "literal", text: "Hello!" }])
  })

  it("holds nothing at all for empty text", () => {
    expect(literalText("")).toEqual([])
  })
})

describe("slotIdsOf", () => {
  it("names each Slot once, in the order it first appears", () => {
    expect(slotIdsOf(greeting)).toEqual(["slot-caller"])
    expect(
      slotIdsOf([
        { kind: "slot", slot: "b" },
        { kind: "literal", text: " and " },
        { kind: "slot", slot: "a" },
        { kind: "slot", slot: "b" }
      ])
    ).toEqual(["b", "a"])
  })
})
