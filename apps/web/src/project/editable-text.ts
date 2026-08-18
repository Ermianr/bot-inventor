import type { SlottedText } from "@bot-inventor/schema"

/**
 * A Slotted text field in the shape the editor edits it in.
 *
 * The Project stores a field as a sequence of segments (ADR 0010), which says
 * what the field means but not where a caret can go. On screen the field is a
 * row of text boxes with pills between them, so what the editing surface needs
 * is the other reading of the same value: the literal texts, and the Slots
 * sitting between them. There is always one more literal than there are Slots
 * — including the empty ones at the ends and between two adjacent pills —
 * because every one of those is a place the user can type.
 *
 * Every edit here is a pure function of that shape, so the rules about what
 * typing beside a pill does can be read and tested without a Canvas.
 */
export type EditableText = {
  /** The text between the Slots, and before the first and after the last. */
  literals: readonly string[]
  /** The Slot ids, in the order they appear. */
  slots: readonly string[]
}

/** Where the caret is: which literal box, and how far into it. */
export type Caret = { literal: number; offset: number }

/** The field as the editor edits it. */
export function editableText(segments: SlottedText): EditableText {
  const literals: string[] = []
  const slots: string[] = []
  let current = ""

  for (const segment of segments) {
    if (segment.kind === "literal") {
      current += segment.text
      continue
    }
    literals.push(current)
    slots.push(segment.slot)
    current = ""
  }
  literals.push(current)

  return { literals, slots }
}

/**
 * The field as the Project stores it. The empty literals the editing shape
 * carries are dropped: they are places to type, not text the user wrote, and
 * writing them to the file would leave a Project full of empty segments.
 */
export function slottedTextOf(editable: EditableText): SlottedText {
  const segments: SlottedText = []

  editable.literals.forEach((text, index) => {
    if (text.length > 0) segments.push({ kind: "literal", text })
    const slot = editable.slots[index]
    if (slot !== undefined) segments.push({ kind: "slot", slot })
  })

  return segments
}

/** What the user typed into one of the text boxes. */
export function withLiteral(editable: EditableText, index: number, text: string): EditableText {
  return {
    ...editable,
    literals: editable.literals.map((current, at) => (at === index ? text : current))
  }
}

/**
 * A Slot dropped into the middle of a literal: the text splits around it, so
 * what was written before the caret stays before the pill and what was written
 * after it stays after.
 */
export function withSlotInserted(editable: EditableText, at: Caret, slot: string): EditableText {
  const text = editable.literals[at.literal] ?? ""
  const offset = Math.min(Math.max(at.offset, 0), text.length)

  return {
    literals: [
      ...editable.literals.slice(0, at.literal),
      text.slice(0, offset),
      text.slice(offset),
      ...editable.literals.slice(at.literal + 1)
    ],
    slots: [...editable.slots.slice(0, at.literal), slot, ...editable.slots.slice(at.literal)]
  }
}

/**
 * A pill taken out of the text, and where the caret lands afterwards.
 *
 * The two literals the pill sat between become one, and the caret goes to the
 * join: the user deleted a word in the middle of a sentence, and the sentence
 * closes up around it exactly as it would have in a plain text box.
 */
export function withSlotRemoved(
  editable: EditableText,
  index: number
): { editable: EditableText; caret: Caret } {
  const before = editable.literals[index] ?? ""
  const after = editable.literals[index + 1] ?? ""

  return {
    editable: {
      literals: [
        ...editable.literals.slice(0, index),
        before + after,
        ...editable.literals.slice(index + 2)
      ],
      slots: editable.slots.filter((_, at) => at !== index)
    },
    caret: { literal: index, offset: before.length }
  }
}

/** How many pills this Slot is drawn as. Removing the last one takes its Port. */
export function slotOccurrences(editable: EditableText, slot: string): number {
  return editable.slots.filter(candidate => candidate === slot).length
}
