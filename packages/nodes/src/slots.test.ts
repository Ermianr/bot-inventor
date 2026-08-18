import { describe, expect, it } from "vitest"
import type { NodeDefinition } from "./definition.js"
import { portsOf } from "./definition.js"
import { slotPortId } from "./slots.js"

/** A Node with two Slotted fields, which the catalogue has none of yet. */
const twoMessages: NodeDefinition = {
  id: "test.twoMessages",
  labelKey: "test.twoMessages.label",
  descriptionKey: "test.twoMessages.description",
  isTrigger: false,
  ports: [{ id: "in", kind: "execution", direction: "input", labelKey: "ports.in.label" }],
  fields: [
    {
      id: "first",
      labelKey: "test.twoMessages.fields.first.label",
      control: "slottedText",
      defaultValue: []
    },
    {
      id: "second",
      labelKey: "test.twoMessages.fields.second.label",
      control: "slottedText",
      defaultValue: []
    },
    {
      id: "note",
      labelKey: "test.twoMessages.fields.note.label",
      control: "text",
      defaultValue: ""
    }
  ],
  generate: () => ""
}

const slotPortIds = (fields: NonNullable<Parameters<typeof portsOf>[1]>) =>
  portsOf(twoMessages, fields)
    .filter(port => port.id.startsWith("slot."))
    .map(port => port.id)

describe("the Ports a Node's Slots declare", () => {
  it("declares one Port for a Slot standing in two fields of the same Node", () => {
    expect(
      slotPortIds({
        first: [{ kind: "slot", slot: "who" }],
        second: [
          { kind: "literal", text: "and " },
          { kind: "slot", slot: "who" }
        ]
      })
    ).toEqual([slotPortId("who")])
  })

  it("declares a Port per Slot, in the order the fields are declared", () => {
    expect(
      slotPortIds({
        second: [{ kind: "slot", slot: "second-one" }],
        first: [{ kind: "slot", slot: "first-one" }]
      })
    ).toEqual([slotPortId("first-one"), slotPortId("second-one")])
  })

  it("reads no Slot out of a field that is not Slotted text", () => {
    expect(slotPortIds({ note: [{ kind: "slot", slot: "who" }] })).toEqual([])
  })

  it("declares nothing for a field a hand-edited Project left unreadable", () => {
    expect(slotPortIds({ first: "just text", second: [{ kind: "slot" }] })).toEqual([])
  })
})
