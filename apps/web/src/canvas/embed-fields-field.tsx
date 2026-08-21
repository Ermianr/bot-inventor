import { type EmbedField, embedFieldValue, readEmbedFields } from "@bot-inventor/nodes"
import { EMBED_LIMITS } from "@bot-inventor/runtime/embed"
import { type FieldValue, type SlottedText, slotIdsOf } from "@bot-inventor/schema"
import { Button } from "@bot-inventor/ui/components/button"
import { Checkbox } from "@bot-inventor/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"
import { Label } from "@bot-inventor/ui/components/label"
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { SlottedField } from "@/canvas/slotted-field"
import { translate } from "@/i18n/messages"
import { fieldPathId } from "@/project/field-path"

/**
 * The name-and-value pairs inside an Embed, edited as a list on the Node.
 *
 * The order the rows are in is the order Discord lays them out, so moving a
 * row is the whole of reordering an Embed: there is no other place that order
 * is written down. Each pair carries the switch that puts it beside its
 * neighbours rather than on a line of its own.
 *
 * A name and a value are Slotted fields like the rest of the Embed, so a pair
 * can say what a Wire carried (ADR 0010) and the Slots inside it declare their
 * Ports on the Node exactly as the Embed's own text fields do.
 *
 * Adding stops at the twenty-five Discord accepts, and says why: a pair the
 * user typed and Discord silently dropped is an Embed that never draws, and
 * they would have nothing to read about it. Pairs a Project already arrived
 * holding past that limit are still drawn, because they are the user's to
 * delete rather than this control's to throw away.
 *
 * Removing a pair that holds the last use of a wired value asks first, for the
 * reason removing the last pill of a Slot does: a Wire the user drew
 * disappearing without being asked about is the editor undoing their work
 * behind their back.
 */
export function EmbedFieldsField({
  fieldId,
  label,
  nodeId,
  onChange,
  slotIsWired,
  slotLabel,
  value
}: {
  fieldId: string
  label: string
  nodeId: string
  onChange: (value: FieldValue) => void
  /** Whether a Wire feeds this Slot, which is what makes removing it a question. */
  slotIsWired: (slot: string) => boolean
  /** What the pill says: where the value comes from, or that nothing feeds it. */
  slotLabel: (slot: string) => string
  value: FieldValue
}) {
  const embedFields = readEmbedFields(value)
  const full = embedFields.length >= EMBED_LIMITS.embedFields

  /** The pair the user is being asked about, when they are being asked. */
  const [asking, setAsking] = useState<number | undefined>(undefined)

  const write = (written: readonly EmbedField[]) => onChange(written.map(embedFieldValue))

  const replace = (index: number, embedField: EmbedField) =>
    write(embedFields.map((current, at) => (at === index ? embedField : current)))

  const remove = (index: number) => {
    setAsking(undefined)
    write(embedFields.filter((_, at) => at !== index))
  }

  /**
   * Removes a pair, asking first when a Wire goes with it: a value used nowhere
   * else in the list loses its Port, and the Wire feeding it with it. A value
   * another pair still uses keeps its Port, so there is nothing to ask about.
   */
  const askThenRemove = (index: number) => {
    const going = embedFields[index]
    if (going === undefined) return

    const elsewhere = new Set(
      embedFields.flatMap((embedField, at) =>
        at === index ? [] : [...slotIdsOf(embedField.name), ...slotIdsOf(embedField.value)]
      )
    )
    const losing = [...slotIdsOf(going.name), ...slotIdsOf(going.value)].filter(
      slot => !elsewhere.has(slot) && slotIsWired(slot)
    )

    if (losing.length > 0) {
      setAsking(index)
      return
    }
    remove(index)
  }

  /** Swaps a pair with its neighbour, which is what moving it up or down is. */
  const move = (index: number, by: number) => {
    const moved = [...embedFields]
    const [taken] = moved.splice(index, 1)
    if (taken === undefined) return
    moved.splice(index + by, 0, taken)
    write(moved)
  }

  return (
    <div className="grid gap-2">
      <Label className="text-xs">{label}</Label>

      {embedFields.map((embedField, index) => (
        <EmbedFieldRow
          embedField={embedField}
          fieldId={fieldId}
          index={index}
          // A pair has nothing stable to be keyed by: its name is what the user
          // is still typing, and two of them may read the same. Its place in
          // the list is what identifies it, and that is what moving one edits.
          // biome-ignore lint/suspicious/noArrayIndexKey: the position is the identity here.
          key={index}
          last={index === embedFields.length - 1}
          move={by => move(index, by)}
          nodeId={nodeId}
          onChange={edited => replace(index, edited)}
          remove={() => askThenRemove(index)}
          slotIsWired={slotIsWired}
          slotLabel={slotLabel}
        />
      ))}

      <Button
        className="nodrag h-7 justify-start px-2 text-xs"
        data-testid={`embed-field-add-${nodeId}-${fieldId}`}
        disabled={full}
        onClick={() => write([...embedFields, { name: [], value: [], inline: false }])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PlusIcon />
        {translate("canvas.embedField.add")}
      </Button>

      {full && (
        <p className="text-xs text-muted-foreground">
          {translate("canvas.embedField.full", { count: String(EMBED_LIMITS.embedFields) })}
        </p>
      )}

      <Dialog onOpenChange={open => !open && setAsking(undefined)} open={asking !== undefined}>
        <DialogContent data-testid="embed-field-removeWire-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{translate("canvas.embedField.removeWire.title")}</DialogTitle>
            <DialogDescription>{translate("canvas.embedField.removeWire.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="embed-field-removeWire-cancel"
              onClick={() => setAsking(undefined)}
              variant="outline"
            >
              {translate("canvas.embedField.removeWire.cancel")}
            </Button>
            <Button
              data-testid="embed-field-removeWire-confirm"
              onClick={() => asking !== undefined && remove(asking)}
              variant="destructive"
            >
              {translate("canvas.embedField.removeWire.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmbedFieldRow({
  embedField,
  fieldId,
  index,
  last,
  move,
  nodeId,
  onChange,
  remove,
  slotIsWired,
  slotLabel
}: {
  embedField: EmbedField
  fieldId: string
  index: number
  /** Whether it is the last pair, which is the one that cannot move down. */
  last: boolean
  move: (by: number) => void
  nodeId: string
  onChange: (embedField: EmbedField) => void
  remove: () => void
  slotIsWired: (slot: string) => boolean
  slotLabel: (slot: string) => string
}) {
  const rowId = `${nodeId}-${fieldId}-${index}`
  // The two halves of a pair are Slotted text without being fields of their
  // own, so each is addressed by where it sits: that address is what a Wire
  // dropped on it is read back as.
  const part = (name: "name" | "value") =>
    fieldPathId({ field: fieldId, embedField: { index, part: name } })

  const withPart = (name: "name" | "value") => (segments: SlottedText) =>
    onChange({ ...embedField, [name]: segments })

  return (
    <div className="grid gap-2 rounded-md border p-2" data-testid={`embed-field-${rowId}`}>
      <SlottedField
        fieldId={part("name")}
        label={translate("canvas.embedField.name")}
        limit={EMBED_LIMITS.embedFieldName}
        nodeId={nodeId}
        onChange={withPart("name")}
        slotIsWired={slotIsWired}
        slotLabel={slotLabel}
        value={embedField.name}
      />
      <SlottedField
        fieldId={part("value")}
        label={translate("canvas.embedField.value")}
        limit={EMBED_LIMITS.embedFieldValue}
        nodeId={nodeId}
        onChange={withPart("value")}
        slotIsWired={slotIsWired}
        slotLabel={slotLabel}
        value={embedField.value}
      />

      <div className="flex items-center gap-2">
        <Checkbox
          checked={embedField.inline}
          className="nodrag"
          data-testid={`embed-field-inline-${rowId}`}
          id={`${rowId}-inline`}
          onCheckedChange={checked => onChange({ ...embedField, inline: checked === true })}
        />
        <Label className="text-xs" htmlFor={`${rowId}-inline`}>
          {translate("canvas.embedField.inline")}
        </Label>

        {/* The three buttons that lay the pair out sit together on the right. */}
        <div className="ml-auto flex items-center">
          <Button
            aria-label={translate("canvas.embedField.moveUp")}
            className="nodrag size-7"
            data-testid={`embed-field-up-${rowId}`}
            disabled={index === 0}
            onClick={() => move(-1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronUpIcon />
          </Button>
          <Button
            aria-label={translate("canvas.embedField.moveDown")}
            className="nodrag size-7"
            data-testid={`embed-field-down-${rowId}`}
            disabled={last}
            onClick={() => move(1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon />
          </Button>
          <Button
            aria-label={translate("canvas.embedField.remove")}
            className="nodrag size-7"
            data-testid={`embed-field-remove-${rowId}`}
            onClick={remove}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </div>
  )
}
