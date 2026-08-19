import type { NodeDefinition } from "@bot-inventor/nodes"
import type { FieldValue, Node } from "@bot-inventor/schema"
import { EmbedPreview } from "@/canvas/embed-preview"
import { drawnFields, FieldRow } from "@/canvas/field-row"
import type { SlotLabel } from "@/canvas/markup-view"
import { translate, translateDefinitionKey } from "@/i18n/messages"

/**
 * The panel beside the Canvas where a Node too big to draw on it is typed into,
 * with a preview of what it builds above the fields that build it.
 *
 * Only a Node that declares a summary is edited here — an Embed holds thirteen
 * fields and a list of pairs, and a Canvas of Nodes that size is a Canvas
 * nobody can read the Flow off. Every other Node is typed into where it sits,
 * because seeing the value next to the wiring is the whole point of a Canvas.
 */
export function Inspector({
  definition,
  node,
  setField,
  slotIsWired,
  slotLabel,
  slotValue
}: {
  definition: NodeDefinition
  node: Node
  setField: (fieldId: string, value: FieldValue) => void
  slotIsWired: (slot: string) => boolean
  slotLabel: SlotLabel
  /** What the most recent Run carried into a Slot, when there has been one. */
  slotValue: (slot: string) => string | undefined
}) {
  return (
    <aside
      aria-label={translate("canvas.inspector.label")}
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-card"
      data-testid={`inspector-${node.id}`}
    >
      <header className="border-b px-3 py-2">
        <p className="font-medium text-sm">{translateDefinitionKey(definition.labelKey)}</p>
        <p className="text-muted-foreground text-xs">
          {translateDefinitionKey(definition.descriptionKey)}
        </p>
      </header>

      {definition.preview === "embed" && (
        <div className="border-b p-3">
          <p className="pb-2 font-medium text-muted-foreground text-xs">
            {translate("canvas.preview.label")}
          </p>
          <EmbedPreview fields={node.fields} slotLabel={slotLabel} slotValue={slotValue} />
        </div>
      )}

      <div className="grid gap-2 p-3">
        {drawnFields(definition.fields).map(field => (
          <FieldRow
            field={field}
            key={field.id}
            nodeId={node.id}
            setField={setField}
            slotIsWired={slotIsWired}
            slotLabel={slotLabel}
            value={node.fields[field.id] ?? field.defaultValue}
          />
        ))}
      </div>
    </aside>
  )
}
