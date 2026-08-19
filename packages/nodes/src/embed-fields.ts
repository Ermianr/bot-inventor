import { EMBED_LIMITS } from "@bot-inventor/runtime/embed"
import { type FieldValue, readSlottedText, type SlottedText } from "@bot-inventor/schema"

/**
 * The name-and-value pairs laid out inside an Embed, as the `embedFields` field
 * holds them.
 *
 * A name and a value are Slotted text like every other text part of an Embed
 * (ADR 0010), so an Embed Field can say what a Wire carried without a Node
 * whose only job is gluing two strings together.
 */

/** One name-and-value pair inside an Embed. */
export type EmbedField = {
  name: SlottedText
  value: SlottedText
  /** Whether it sits beside its neighbours rather than on a line of its own. */
  inline: boolean
}

/**
 * One pair exactly as the Project wrote it, before its name and its value are
 * read as text. The Compiler wants this rather than the reading below: a name
 * that does not read as text at all is a name it has to refuse, and something
 * that has already turned it into empty text has nothing left to refuse.
 */
export type WrittenEmbedField = {
  name: FieldValue
  value: FieldValue
  inline: boolean
}

/**
 * How many Embed Fields Discord accepts on one Embed. It is what the editor
 * stops the user at; nothing throws the ones past it away, because a Project
 * that arrived holding them is a Project whose pairs are the user's to delete —
 * the Embed says it is over the limit until they do.
 *
 * It is the Runtime's limit and not a second reading of it: the editor and the
 * generated code cannot disagree about a number neither of them owns.
 */
export const MAX_EMBED_FIELDS = EMBED_LIMITS.embedFields

/**
 * The Embed Fields an `embedFields` field holds, as they were written.
 *
 * A Project is a file that an older build wrote or that someone edited by hand,
 * so anything at all reaches here. What is not a pair at all is dropped, for
 * the reason a half-typed slash command parameter is: the editor has to keep
 * drawing the Node while the user is still writing it.
 */
export function writtenEmbedFields(value: FieldValue | undefined): WrittenEmbedField[] {
  if (!Array.isArray(value)) return []

  const embedFields: WrittenEmbedField[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue
    embedFields.push({
      name: entry.name ?? [],
      value: entry.value ?? [],
      inline: entry.inline === true
    })
  }
  return embedFields
}

/**
 * The same pairs with their names and values read as text, which is what the
 * editor draws and what the Slots inside them are found in. A name that does
 * not read as text reads as empty here; the Compiler is where that is refused.
 */
export function readEmbedFields(value: FieldValue | undefined): EmbedField[] {
  return writtenEmbedFields(value).map(embedField => ({
    name: readSlottedText(embedField.name),
    value: readSlottedText(embedField.value),
    inline: embedField.inline
  }))
}

/** An Embed Field as a `FieldValue`, which is what a Project stores. */
export function embedFieldValue(embedField: EmbedField): FieldValue {
  return { name: embedField.name, value: embedField.value, inline: embedField.inline }
}
