import { type FieldDefinition, isSlotted } from "@bot-inventor/nodes"
import { type FieldValue, readSlottedText } from "@bot-inventor/schema"
import { Checkbox } from "@bot-inventor/ui/components/checkbox"
import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"

import { colourHex, colourNumber } from "@/canvas/colour"
import { EmbedFieldsField } from "@/canvas/embed-fields-field"
import { SlottedField } from "@/canvas/slotted-field"
import { translateDefinitionKey } from "@/i18n/messages"

/**
 * One field of a Node, drawn as whatever control the Node asked for.
 *
 * It is a component of its own because a field is typed into in two places: on
 * the Node itself, and in the Inspector for a Node too big to draw on the
 * Canvas. Both are the same control over the same value, and neither knows
 * which Node it belongs to beyond the definition it was handed (ADR 0001).
 */

/**
 * `commandParameters` is not drawn yet: it is a list of declarations rather
 * than one value, and it needs a control of its own — the one an Embed's pairs
 * are edited with is what that will look like. A Flow can already read what the
 * caller answered — the Ports are there as soon as the field holds parameters —
 * so what is left is the editing surface.
 */
const DRAWN_CONTROLS = new Set<FieldDefinition["control"]>([
  "text",
  "slottedText",
  "slottedParagraph",
  "number",
  "switch",
  "embedFields",
  "colour"
])

/** The fields of a Node that there is a control to type into. */
export function drawnFields(fields: readonly FieldDefinition[]): readonly FieldDefinition[] {
  return fields.filter(field => DRAWN_CONTROLS.has(field.control))
}

export function FieldRow({
  field,
  nodeId,
  setField,
  slotIsWired,
  slotLabel,
  value
}: {
  field: FieldDefinition
  nodeId: string
  setField: (fieldId: string, value: FieldValue) => void
  slotIsWired: (slot: string) => boolean
  slotLabel: (slot: string) => string
  value: FieldValue
}) {
  const inputId = `${nodeId}-${field.id}`
  const label = translateDefinitionKey(field.labelKey)

  // A Slotted field is a text box with the values that were dropped into it
  // drawn as pills inside the sentence (ADR 0010), written over one line or
  // over several depending on which control the Node asked for.
  if (isSlotted(field.control)) {
    return (
      <SlottedField
        fieldId={field.id}
        label={label}
        limit={field.limit}
        multiline={field.control === "slottedParagraph"}
        nodeId={nodeId}
        onChange={segments => setField(field.id, segments)}
        slotIsWired={slotIsWired}
        slotLabel={slotLabel}
        value={readSlottedText(value)}
      />
    )
  }

  // The pairs inside an Embed are a list rather than one value: how many there
  // are is the user's to decide, and the order they are in is the layout.
  if (field.control === "embedFields") {
    return (
      <EmbedFieldsField
        fieldId={field.id}
        label={label}
        nodeId={nodeId}
        onChange={embedFields => setField(field.id, embedFields)}
        slotIsWired={slotIsWired}
        slotLabel={slotLabel}
        value={value}
      />
    )
  }

  // A colour is picked, never typed: the Project stores the integer Discord
  // takes, and the user only ever sees the swatch it stands for.
  if (field.control === "colour") {
    return (
      <div className="grid gap-1">
        <Label className="text-xs" htmlFor={inputId}>
          {label}
        </Label>
        <Input
          className="nodrag h-8 w-16 p-1"
          id={inputId}
          onChange={event => setField(field.id, colourNumber(event.target.value))}
          type="color"
          value={colourHex(value)}
        />
      </div>
    )
  }

  if (field.control === "switch") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          checked={value === true}
          id={inputId}
          onCheckedChange={checked => setField(field.id, checked)}
        />
        <Label className="text-xs" htmlFor={inputId}>
          {label}
        </Label>
      </div>
    )
  }

  return (
    <div className="grid gap-1">
      <Label className="text-xs" htmlFor={inputId}>
        {label}
      </Label>
      <Input
        className="nodrag h-8"
        id={inputId}
        onChange={event =>
          setField(
            field.id,
            field.control === "number" ? Number(event.target.value) : event.target.value
          )
        }
        type={field.control === "number" ? "number" : "text"}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
      />
    </div>
  )
}
