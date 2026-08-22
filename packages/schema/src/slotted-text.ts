import { z } from "zod"

import type { FieldValue } from "./project.js"
import type { Validator } from "./validator.js"

/**
 * The value of a text field: a sequence of literal text and Slots (ADR 0010).
 *
 * A Slot is a hole with an opaque id, generated when the Slot is inserted and
 * stored in the segment rather than derived from where the Slot sits, so typing
 * a word in front of one does not move it onto another Wire. The same id may
 * appear in more than one segment and in more than one field of a Node.
 */

export type LiteralSegment = {
  kind: "literal"
  text: string
}

const literalSegment = z.object({
  kind: z.literal("literal"),
  text: z.string()
})

export const literalSegmentSchema: Validator<LiteralSegment> = literalSegment

export type SlotSegment = {
  kind: "slot"
  slot: string
}

const slotSegment = z.object({
  kind: z.literal("slot"),
  slot: z.string().min(1, "a Slot id must not be empty")
})

export const slotSegmentSchema: Validator<SlotSegment> = slotSegment

export type TextSegment = LiteralSegment | SlotSegment

/**
 * The union is built from the object schemas rather than from the exported
 * aliases: `discriminatedUnion` needs to see the objects to find the
 * discriminant, and a `Validator` deliberately no longer says it is one.
 */
const textSegment = z.discriminatedUnion("kind", [literalSegment, slotSegment])

export const textSegmentSchema: Validator<TextSegment> = textSegment

/** A text field's whole value, in the order it reads. */
export type SlottedText = TextSegment[]

export const slottedTextSchema: Validator<SlottedText> = z.array(textSegment)

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
