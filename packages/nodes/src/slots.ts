import { type FieldValue, readSlottedText, type SlottedText, slotIdsOf } from "@bot-inventor/schema"
import type { DataPortDefinition, FieldControl, FieldDefinition, NodeFields } from "./definition.js"
import { readEmbedFields } from "./embed-fields.js"

/**
 * A Slot is a hole inside a text field, filled by a value that arrives along a
 * Wire (ADR 0010). It declares a Data input Port of type `text` on the Node
 * that owns the field, so a value reaches it the way every other value reaches
 * a Node, through the Coercion table.
 */

/**
 * The prefix a Slot's Port id carries, keeping the opaque ids Slots are given
 * out of the way of the Ports a Node declares for itself.
 */
const PORT_PREFIX = "slot."

/** Whether a field is one a Slot can be put inside of, however it is written. */
export function isSlotted(control: FieldControl): boolean {
  return control === "slottedText" || control === "slottedParagraph"
}

/**
 * Every piece of Slotted text one field holds, in the order it reads.
 *
 * A field is usually one such piece, but a list of Embed Fields is two per
 * entry — a name and a value — and those are Slotted just as much as the parts
 * of the Embed around them. Answering that here is what lets everything that
 * asks about Slots keep asking about fields.
 */
export function slottedTextsOf(
  control: FieldControl,
  value: FieldValue | undefined
): readonly SlottedText[] {
  if (isSlotted(control)) return [readSlottedText(value)]
  if (control === "embedFields") {
    return readEmbedFields(value).flatMap(embedField => [embedField.name, embedField.value])
  }
  return []
}

/** The Port a Slot of this id is fed through. */
export function slotPortId(slot: string): string {
  return `${PORT_PREFIX}${slot}`
}

/**
 * The Ports the Slots of a Node's fields declare, once per Slot id.
 *
 * The same Slot may appear in more than one segment, in more than one field of
 * the same Node and inside one of its Embed Fields, and all of those
 * occurrences are the one hole: a Port already feeds however many places want
 * it.
 */
export function slotPorts(
  fields: readonly FieldDefinition[],
  values: NodeFields
): readonly DataPortDefinition[] {
  const seen = new Set<string>()
  const ports: DataPortDefinition[] = []

  for (const field of fields) {
    for (const segments of slottedTextsOf(field.control, values[field.id])) {
      for (const slot of slotIdsOf(segments)) {
        if (seen.has(slot)) continue
        seen.add(slot)
        ports.push({
          id: slotPortId(slot),
          kind: "data",
          direction: "input",
          dataType: "text",
          labelKey: "ports.slot.label"
        })
      }
    }
  }

  return ports
}
