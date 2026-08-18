// @vitest-environment jsdom

import type { SlottedText } from "@bot-inventor/schema"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { SlottedField } from "@/canvas/slotted-field"

/**
 * A text field with values inside it, as the user edits it.
 *
 * The rules about what an edit does to the sequence are `editable-text`'s and
 * are tested there. What is proved here is the surface: that a pill is drawn
 * where the Slot sits, that it can never be half-deleted, and that a Wire is
 * never taken away without the user being asked first.
 */

// The dialog a pill's removal asks through is drawn on the body rather than
// inside the field, so one test's field is still standing in the next one's way
// unless it is taken down.
afterEach(cleanup)

function draw(
  value: SlottedText,
  options: {
    multiline?: boolean
    onChange?: (value: SlottedText) => void
    slotIsWired?: (slot: string) => boolean
  } = {}
) {
  const { container } = render(
    <SlottedField
      fieldId="content"
      label="Message"
      multiline={options.multiline ?? false}
      nodeId="reply"
      onChange={options.onChange ?? (() => {})}
      slotIsWired={options.slotIsWired ?? (() => false)}
      slotLabel={slot => `from ${slot}`}
      value={value}
    />
  )
  return container
}

function box(container: HTMLElement, index: number): HTMLTextAreaElement {
  return within(container).getByTestId(`field-box-reply-content-${index}`) as HTMLTextAreaElement
}

describe("drawing a field with a value in it", () => {
  it("draws the Slot as a pill, named after where its value comes from", () => {
    const container = draw([
      { kind: "literal", text: "Hello, " },
      { kind: "slot", slot: "caller" }
    ])

    expect(within(container).getByTestId("slot-reply-content-0").textContent).toContain(
      "from caller"
    )
  })

  it("leaves somewhere to type before a pill, after it, and between two of them", () => {
    const container = draw([
      { kind: "slot", slot: "caller" },
      { kind: "slot", slot: "server" }
    ])

    expect(box(container, 0).value).toBe("")
    expect(box(container, 1).value).toBe("")
    expect(box(container, 2).value).toBe("")
  })

  it("keeps the text on either side of a pill in its own box", () => {
    const container = draw([
      { kind: "literal", text: "Hello, " },
      { kind: "slot", slot: "caller" },
      { kind: "literal", text: "!" }
    ])

    expect(box(container, 0).value).toBe("Hello, ")
    expect(box(container, 1).value).toBe("!")
  })
})

describe("typing around a pill", () => {
  it("keeps the pill where it is when text is typed in front of it", () => {
    const written: SlottedText[] = []
    const container = draw([{ kind: "slot", slot: "caller" }], {
      onChange: value => written.push(value)
    })

    fireEvent.change(box(container, 0), { target: { value: "Hello, " } })

    expect(written).toEqual([
      [
        { kind: "literal", text: "Hello, " },
        { kind: "slot", slot: "caller" }
      ]
    ])
  })

  it("keeps the pill where it is when text is typed after it", () => {
    const written: SlottedText[] = []
    const container = draw([{ kind: "slot", slot: "caller" }], {
      onChange: value => written.push(value)
    })

    fireEvent.change(box(container, 1), { target: { value: "!" } })

    expect(written).toEqual([
      [
        { kind: "slot", slot: "caller" },
        { kind: "literal", text: "!" }
      ]
    ])
  })

  it("types between two pills without disturbing either", () => {
    const written: SlottedText[] = []
    const container = draw(
      [
        { kind: "slot", slot: "caller" },
        { kind: "slot", slot: "server" }
      ],
      { onChange: value => written.push(value) }
    )

    fireEvent.change(box(container, 1), { target: { value: " of " } })

    expect(written).toEqual([
      [
        { kind: "slot", slot: "caller" },
        { kind: "literal", text: " of " },
        { kind: "slot", slot: "server" }
      ]
    ])
  })
})

describe("deleting a pill", () => {
  const wired = [
    { kind: "literal" as const, text: "Hello, " },
    { kind: "slot" as const, slot: "caller" },
    { kind: "literal" as const, text: "!" }
  ]

  it("takes the whole pill when the user backspaces into it", () => {
    const written: SlottedText[] = []
    const container = draw(wired, { onChange: value => written.push(value) })

    const after = box(container, 1)
    after.setSelectionRange(0, 0)
    fireEvent.keyDown(after, { key: "Backspace" })

    expect(written).toEqual([[{ kind: "literal", text: "Hello, !" }]])
  })

  it("takes the whole pill when the user presses Delete in front of it", () => {
    const written: SlottedText[] = []
    const container = draw(wired, { onChange: value => written.push(value) })

    const before = box(container, 0)
    before.setSelectionRange(before.value.length, before.value.length)
    fireEvent.keyDown(before, { key: "Delete" })

    expect(written).toEqual([[{ kind: "literal", text: "Hello, !" }]])
  })

  it("takes the pill when its own control is used", () => {
    const written: SlottedText[] = []
    const container = draw(wired, { onChange: value => written.push(value) })

    fireEvent.click(within(container).getByTestId("slot-remove-reply-content-0"))

    expect(written).toEqual([[{ kind: "literal", text: "Hello, !" }]])
  })

  it("leaves the text alone when Backspace is pressed anywhere but at the start", () => {
    const written: SlottedText[] = []
    const container = draw(wired, { onChange: value => written.push(value) })

    const after = box(container, 1)
    after.setSelectionRange(1, 1)
    fireEvent.keyDown(after, { key: "Backspace" })

    // The browser deletes the character itself; nothing about the Slots moved.
    expect(written).toEqual([])
  })
})

describe("a pill whose Wire would go with it", () => {
  const wired = [
    { kind: "literal" as const, text: "Hello, " },
    { kind: "slot" as const, slot: "caller" }
  ]

  it("says the Wire will go, rather than letting it disappear", () => {
    const written: SlottedText[] = []
    draw(wired, { onChange: value => written.push(value), slotIsWired: () => true })

    fireEvent.click(screen.getByTestId("slot-remove-reply-content-0"))

    expect(screen.getByTestId("slot-remove-dialog")).toBeDefined()
    expect(written).toEqual([])
  })

  it("removes both once the user has said so", () => {
    const written: SlottedText[] = []
    draw(wired, { onChange: value => written.push(value), slotIsWired: () => true })

    fireEvent.click(screen.getByTestId("slot-remove-reply-content-0"))
    fireEvent.click(screen.getByTestId("slot-remove-confirm"))

    expect(written).toEqual([[{ kind: "literal", text: "Hello, " }]])
  })

  it("leaves the pill and the Wire alone when the user changes their mind", () => {
    const written: SlottedText[] = []
    draw(wired, { onChange: value => written.push(value), slotIsWired: () => true })

    fireEvent.click(screen.getByTestId("slot-remove-reply-content-0"))
    fireEvent.click(screen.getByTestId("slot-remove-cancel"))

    expect(written).toEqual([])
  })

  it("asks nothing when the Slot is still used elsewhere in the field", () => {
    const written: SlottedText[] = []
    draw(
      [
        { kind: "slot", slot: "caller" },
        { kind: "literal", text: " and " },
        { kind: "slot", slot: "caller" }
      ],
      { onChange: value => written.push(value), slotIsWired: () => true }
    )

    fireEvent.click(screen.getByTestId("slot-remove-reply-content-0"))

    // The Port is fed by the pill that is still there, so no Wire is at stake.
    expect(screen.queryByTestId("slot-remove-dialog")).toBeNull()
    expect(written).toEqual([
      [
        { kind: "literal", text: " and " },
        { kind: "slot", slot: "caller" }
      ]
    ])
  })
})

/**
 * A field written over several lines. It is the same field either way — the
 * same boxes, the same pills — and what a paragraph adds is the Enter that
 * opens a second line, which a one-line field has to turn down.
 */
describe("writing a field over several lines", () => {
  it("keeps a newline the user typed into a paragraph", () => {
    // A real line break, written as one: a paragraph is the field that keeps it.
    const twoLines = `First
Second`
    const written: SlottedText[] = []
    const container = draw([{ kind: "literal", text: "" }], {
      multiline: true,
      onChange: value => written.push(value)
    })

    fireEvent.change(box(container, 0), { target: { value: twoLines } })

    expect(written).toEqual([[{ kind: "literal", text: twoLines }]])
  })

  it("refuses the Enter that would open a second line in a one-line field", () => {
    const container = draw([{ kind: "literal", text: "Hello" }])

    expect(fireEvent.keyDown(box(container, 0), { key: "Enter" })).toBe(false)
  })

  it("lets Enter through in a paragraph, so a second line can be opened", () => {
    const container = draw([{ kind: "literal", text: "Hello" }], { multiline: true })

    expect(fireEvent.keyDown(box(container, 0), { key: "Enter" })).toBe(true)
  })
})
