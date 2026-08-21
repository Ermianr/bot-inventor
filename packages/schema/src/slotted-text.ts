import { z } from "zod"

import type { FieldValue } from "./project.js"

/**
 * The value of a text field: a sequence of literal text and Slots (ADR 0010).
 *
 * A Slot is a hole with an opaque id, generated when the Slot is inserted and
 * stored in the segment rather than derived from where the Slot sits, so typing
 * a word in front of one does not move it onto another Wire. The same id may
 * appear in more than one segment and in more than one field of a Node.
 */

export const literalSegmentSchema = z.object({
  kind: z.literal("literal"),
  text: z.string()
})

export const slotSegmentSchema = z.object({
  kind: z.literal("slot"),
  slot: z.string().min(1, "a Slot id must not be empty")
})

export const textSegmentSchema = z.discriminatedUnion("kind", [
  literalSegmentSchema,
  slotSegmentSchema
])

/** A text field's whole value, in the order it reads. */
export const slottedTextSchema = z.array(textSegmentSchema)

export type LiteralSegment = z.infer<typeof literalSegmentSchema>
export type SlotSegment = z.infer<typeof slotSegmentSchema>
export type TextSegment = z.infer<typeof textSegmentSchema>
export type SlottedText = z.infer<typeof slottedTextSchema>

/**
 * The segments a field holds.
 *
 * A Project is a file an older build wrote or someone edited by hand, so
 * anything at all reaches here. What is not a sequence of segments reads as
 * empty rather than throwing, for the same reason a half-typed slash command
 * parameter does: the editor has to keep drawing the Node, and the Compiler
 * says what it cannot emit in its own words.
 */
export function readSlottedText(value: FieldValue | undefined): SlottedText {
  const parsed = slottedTextSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/** A field holding one piece of text and no Slots. */
export function literalText(text: string): SlottedText {
  return text.length === 0 ? [] : [{ kind: "literal", text }]
}

/** The ids of the Slots a sequence names, once each, in the order they appear. */
export function slotIdsOf(segments: SlottedText): readonly string[] {
  const ids: string[] = []
  for (const segment of segments) {
    if (segment.kind === "slot" && !ids.includes(segment.slot)) ids.push(segment.slot)
  }
  return ids
}
