import { describe, expect, it } from "vitest"

import {
  editableText,
  slotOccurrences,
  slottedTextOf,
  withLiteral,
  withSlotInserted,
  withSlotRemoved
} from "@/project/editable-text"

/**
 * The rules about typing around a pill, read without a Canvas.
 *
 * The editing shape is what the field looks like to a caret, and the stored
 * shape is what the Project keeps. Everything here is about the two agreeing.
 */

describe("reading a field as the editor edits it", () => {
  it("gives a field with no Slots one place to type", () => {
    expect(editableText([{ kind: "literal", text: "Hello" }])).toEqual({
      literals: ["Hello"],
      slots: []
    })
  })

  it("gives an empty field one place to type", () => {
    expect(editableText([])).toEqual({ literals: [""], slots: [] })
  })

  it("leaves a place to type before the first pill and after the last", () => {
    expect(editableText([{ kind: "slot", slot: "who" }])).toEqual({
      literals: ["", ""],
      slots: ["who"]
    })
  })

  it("leaves a place to type between two pills that sit side by side", () => {
    const editable = editableText([
      { kind: "slot", slot: "who" },
      { kind: "slot", slot: "where" }
    ])

    expect(editable).toEqual({ literals: ["", "", ""], slots: ["who", "where"] })
  })

  it("joins literals the Project happens to have stored apart", () => {
    const editable = editableText([
      { kind: "literal", text: "Hello, " },
      { kind: "literal", text: "you" }
    ])

    expect(editable).toEqual({ literals: ["Hello, you"], slots: [] })
  })
})

describe("writing a field back to the Project", () => {
  it("drops the empty places to type, which are not text the user wrote", () => {
    expect(slottedTextOf({ literals: ["", ""], slots: ["who"] })).toEqual([
      { kind: "slot", slot: "who" }
    ])
  })

  it("keeps the text on either side of a pill", () => {
    expect(slottedTextOf({ literals: ["Hello, ", "!"], slots: ["who"] })).toEqual([
      { kind: "literal", text: "Hello, " },
      { kind: "slot", slot: "who" },
      { kind: "literal", text: "!" }
    ])
  })

  it("reads back what it was read from", () => {
    const segments = [
      { kind: "literal" as const, text: "Hello, " },
      { kind: "slot" as const, slot: "who" },
      { kind: "literal" as const, text: " of " },
      { kind: "slot" as const, slot: "where" }
    ]

    expect(slottedTextOf(editableText(segments))).toEqual(segments)
  })
})

describe("typing into a field", () => {
  it("changes only the box that was typed into", () => {
    const editable = { literals: ["Hello, ", "!"], slots: ["who"] }

    expect(withLiteral(editable, 1, "?")).toEqual({ literals: ["Hello, ", "?"], slots: ["who"] })
  })
})

describe("dropping a Slot into the text", () => {
  it("splits the text around the caret", () => {
    const editable = editableText([{ kind: "literal", text: "Hello world" }])

    expect(withSlotInserted(editable, { literal: 0, offset: 6 }, "who")).toEqual({
      literals: ["Hello ", "world"],
      slots: ["who"]
    })
  })

  it("puts a Slot between two that are already there", () => {
    const editable = { literals: ["a", "b", "c"], slots: ["one", "two"] }

    expect(withSlotInserted(editable, { literal: 1, offset: 1 }, "half")).toEqual({
      literals: ["a", "b", "", "c"],
      slots: ["one", "half", "two"]
    })
  })

  it("puts a Slot at the end of a field the caret has never been in", () => {
    const editable = editableText([{ kind: "literal", text: "Hello" }])

    expect(withSlotInserted(editable, { literal: 0, offset: 99 }, "who")).toEqual({
      literals: ["Hello", ""],
      slots: ["who"]
    })
  })

  it("lets the same Slot be used again without a second Wire", () => {
    const once = withSlotInserted(editableText([]), { literal: 0, offset: 0 }, "who")
    const twice = withSlotInserted(once, { literal: 1, offset: 0 }, "who")

    expect(twice.slots).toEqual(["who", "who"])
    expect(slottedTextOf(twice)).toEqual([
      { kind: "slot", slot: "who" },
      { kind: "slot", slot: "who" }
    ])
  })
})

describe("deleting a pill", () => {
  it("closes the sentence up around it and leaves the caret at the join", () => {
    const editable = { literals: ["Hello, ", "!"], slots: ["who"] }

    expect(withSlotRemoved(editable, 0)).toEqual({
      editable: { literals: ["Hello, !"], slots: [] },
      caret: { literal: 0, offset: 7 }
    })
  })

  it("takes the whole pill or none of it, whichever it sits between", () => {
    const editable = { literals: ["a", "b", "c"], slots: ["one", "two"] }

    expect(withSlotRemoved(editable, 1).editable).toEqual({
      literals: ["a", "bc"],
      slots: ["one"]
    })
  })
})

describe("how many times a Slot is drawn", () => {
  it("counts every pill the Slot appears as", () => {
    expect(slotOccurrences({ literals: ["", " and ", ""], slots: ["who", "who"] }, "who")).toBe(2)
  })

  it("says a Slot that is no longer anywhere is drawn nowhere", () => {
    expect(slotOccurrences({ literals: [""], slots: [] }, "who")).toBe(0)
  })
})
