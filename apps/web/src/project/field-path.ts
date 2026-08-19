import {
  type EmbedField,
  embedFieldValue,
  type NodeFields,
  readEmbedFields
} from "@bot-inventor/nodes"
import { type FieldValue, readSlottedText, type SlottedText } from "@bot-inventor/schema"

/**
 * Where one piece of Slotted text lives on a Node.
 *
 * Most of them are a field of their own, and the field's id says everything.
 * The name and the value of an Embed Field do not: they live inside the list
 * their field holds, and what identifies them is the field, which pair, and
 * which half of it. A path is that address written as one string, because the
 * editing surface that carries it — a text box, and the `data-slot-field` a
 * dropped Wire is read off — has room for a string and nothing else.
 */

/** One piece of Slotted text on a Node, by the field it is in and where inside it. */
export type FieldPath = {
  field: string
  /** Which pair of an Embed Fields list, and which half of it, when it is one. */
  embedField?: { index: number; part: "name" | "value" }
}

/** The string a path is carried through the DOM as. */
export function fieldPathId(path: FieldPath): string {
  const { field, embedField } = path
  return embedField === undefined ? field : `${field}.${embedField.index}.${embedField.part}`
}

/**
 * The path a string names. A field id has no dots in it — they are declared in
 * the catalogue — so anything that is not the shape written above is the plain
 * field it looks like.
 */
export function readFieldPath(id: string): FieldPath {
  const parts = id.split(".")
  if (parts.length !== 3) return { field: id }

  const [field, written, part] = parts
  const index = Number(written)
  if (field === undefined || !Number.isInteger(index) || index < 0) return { field: id }
  if (part !== "name" && part !== "value") return { field: id }

  return { field, embedField: { index, part } }
}

/** The Slotted text a path points at, or empty text when nothing is written there. */
export function slottedTextAt(fields: NodeFields, path: FieldPath): SlottedText {
  if (path.embedField === undefined) return readSlottedText(fields[path.field])

  const embedField = readEmbedFields(fields[path.field])[path.embedField.index]
  return embedField === undefined ? [] : embedField[path.embedField.part]
}

/**
 * What the whole field becomes once the text at a path is written: the text
 * itself for a plain field, and the list with one pair edited for an Embed
 * Field. The field is what a Project stores and what an edit replaces, so a
 * path pointing inside one still comes back out as the field.
 */
export function fieldWithSlottedTextAt(
  fields: NodeFields,
  path: FieldPath,
  segments: SlottedText
): FieldValue {
  if (path.embedField === undefined) return segments

  const { index, part } = path.embedField
  const embedFields = readEmbedFields(fields[path.field])
  return embedFields
    .map(
      (embedField, at): EmbedField =>
        at === index ? { ...embedField, [part]: segments } : embedField
    )
    .map(embedFieldValue)
}
