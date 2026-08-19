// @vitest-environment jsdom

import { MAX_EMBED_FIELDS } from "@bot-inventor/nodes"
import { type FieldValue, literalText } from "@bot-inventor/schema"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { EmbedFieldsField } from "@/canvas/embed-fields-field"

/**
 * The list of name-and-value pairs on an Embed Node. The order the rows are in
 * is the layout Discord draws, so what this proves above all is that a pair
 * moved on the Canvas is a pair moved in the Embed.
 */

const twoPairs: FieldValue = [
  { name: literalText("Rule 1"), value: literalText("Be kind"), inline: false },
  { name: literalText("Rule 2"), value: literalText("Be brief"), inline: false }
]

function draw(value: FieldValue, slotIsWired: (slot: string) => boolean = () => false) {
  const onChange = vi.fn()
  const { container } = render(
    <EmbedFieldsField
      fieldId="embedFields"
      label="Pairs"
      nodeId="embed"
      onChange={onChange}
      slotIsWired={slotIsWired}
      slotLabel={() => ""}
      value={value}
    />
  )

  const rows = () => within(container).queryAllByTestId(/^embed-field-embed-embedFields-\d+$/)
  return { container, onChange, rows }
}

/** One of the boxes a Slotted name or value is typed into. */
function box(container: HTMLElement, fieldId: string): HTMLTextAreaElement {
  return within(container).getByTestId(`field-box-embed-${fieldId}-0`) as HTMLTextAreaElement
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  return within(container).getByTestId(testId) as HTMLButtonElement
}

/** What one row's controls were written back as, out of the last edit. */
function written(onChange: ReturnType<typeof vi.fn>): FieldValue {
  const last = onChange.mock.calls.at(-1)
  if (last === undefined) throw new Error("nothing was written back")
  return last[0] as FieldValue
}

describe("editing the Embed Fields of an Embed", () => {
  it("draws one row per pair, with the name and the value written into it", () => {
    const { container, rows } = draw(twoPairs)

    expect(rows()).toHaveLength(2)
    expect(box(container, "embedFields.0.name").value).toBe("Rule 1")
    expect(box(container, "embedFields.1.value").value).toBe("Be brief")
  })

  it("adds an empty pair at the end", () => {
    const { container, onChange } = draw(twoPairs)

    fireEvent.click(within(container).getByTestId("embed-field-add-embed-embedFields"))

    expect(written(onChange)).toEqual([
      ...(twoPairs as unknown[]),
      { name: [], value: [], inline: false }
    ])
  })

  it("stops the user at the twenty-five pairs Discord accepts", () => {
    const full = Array.from({ length: MAX_EMBED_FIELDS }, (_, index) => ({
      name: literalText(`Rule ${index}`),
      value: literalText("Be kind"),
      inline: false
    }))
    const { container, rows } = draw(full)

    expect(rows()).toHaveLength(MAX_EMBED_FIELDS)
    expect(button(container, "embed-field-add-embed-embedFields").disabled).toBe(true)
  })

  it("moves a pair past the one below it, which is what reorders the Embed", () => {
    const { container, onChange } = draw(twoPairs)

    fireEvent.click(within(container).getByTestId("embed-field-down-embed-embedFields-0"))

    expect(written(onChange)).toEqual([(twoPairs as unknown[])[1], (twoPairs as unknown[])[0]])
  })

  it("cannot move the first pair up or the last one down", () => {
    const { container } = draw(twoPairs)

    expect(button(container, "embed-field-up-embed-embedFields-0").disabled).toBe(true)
    expect(button(container, "embed-field-down-embed-embedFields-1").disabled).toBe(true)
  })

  it("takes a pair away", () => {
    const { container, onChange } = draw(twoPairs)

    fireEvent.click(within(container).getByTestId("embed-field-remove-embed-embedFields-0"))

    expect(written(onChange)).toEqual([(twoPairs as unknown[])[1]])
  })

  it("asks before a removed pair takes the Wire feeding it away as well", () => {
    const wired: FieldValue = [
      { name: literalText("Asked by"), value: [{ kind: "slot", slot: "who" }], inline: false }
    ]
    const { container, onChange, rows } = draw(wired, slot => slot === "who")

    fireEvent.click(button(container, "embed-field-remove-embed-embedFields-0"))

    expect(onChange).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(1)

    fireEvent.click(screen.getByTestId("embed-field-removeWire-confirm"))

    expect(written(onChange)).toEqual([])
  })

  it("keeps the pair when the question about its Wire is turned down", () => {
    const wired: FieldValue = [
      { name: literalText("Asked by"), value: [{ kind: "slot", slot: "who" }], inline: false }
    ]
    const { container, onChange } = draw(wired, slot => slot === "who")

    fireEvent.click(button(container, "embed-field-remove-embed-embedFields-0"))
    fireEvent.click(screen.getByTestId("embed-field-removeWire-cancel"))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not ask when the same value is still used by another pair", () => {
    const twice: FieldValue = [
      { name: literalText("Asked by"), value: [{ kind: "slot", slot: "who" }], inline: false },
      { name: literalText("And by"), value: [{ kind: "slot", slot: "who" }], inline: false }
    ]
    const { container, onChange } = draw(twice, slot => slot === "who")

    fireEvent.click(button(container, "embed-field-remove-embed-embedFields-0"))

    expect(written(onChange)).toEqual([(twice as unknown[])[1]])
  })

  it("puts a pair beside its neighbours when the inline switch is turned on", () => {
    const { container, onChange } = draw(twoPairs)

    fireEvent.click(within(container).getByTestId("embed-field-inline-embed-embedFields-1"))

    expect(written(onChange)).toEqual([
      (twoPairs as unknown[])[0],
      { name: literalText("Rule 2"), value: literalText("Be brief"), inline: true }
    ])
  })

  it("draws nothing but the add button for an Embed with no pairs yet", () => {
    const { container, rows } = draw([])

    expect(rows()).toEqual([])
    expect(button(container, "embed-field-add-embed-embedFields").disabled).toBe(false)
  })
})
