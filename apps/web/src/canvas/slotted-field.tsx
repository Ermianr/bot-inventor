import type { SlottedText } from "@bot-inventor/schema"
import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"
import { Label } from "@bot-inventor/ui/components/label"
import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { translate } from "@/i18n/messages"
import {
  type Caret,
  editableText,
  slotOccurrences,
  slottedTextOf,
  withLiteral,
  withSlotRemoved
} from "@/project/editable-text"

/**
 * The element one gap between two pills is typed into. It is a textarea whether
 * or not the field is a paragraph, so that both kinds of field grow, wrap and
 * carry the caret in exactly the same way; what a one-line field does instead
 * is refuse the Enter that would open a second line.
 */
type SlotBox = HTMLTextAreaElement

/**
 * A text field a value can be dropped into: one text box, with the Slots drawn
 * as pills inside the sentence (ADR 0010).
 *
 * It is built from a text box per literal and a pill between each pair rather
 * than from one editable region, because that is what makes a pill atomic
 * without anybody having to enforce it: a pill is not text the caret can stand
 * inside, so there is no half of one to select, type over or delete. The caret
 * still crosses the whole field — the arrow keys step from one box into the
 * next, Backspace at the start of a box eats the pill in front of it — so the
 * field reads and behaves as the single sentence it is.
 *
 * Removing the last pill of a Slot takes its Port and the Wire drawn to it,
 * because the Port exists only for as long as the field names the Slot. That is
 * worth a question first: a Wire the user drew disappearing without being asked
 * about is the editor undoing their work behind their back.
 */
export function SlottedField({
  fieldId,
  label,
  multiline = false,
  limit,
  nodeId,
  onChange,
  slotIsWired,
  slotLabel,
  value
}: {
  fieldId: string
  label: string
  /**
   * How many characters the field takes, when whatever reads it refuses a
   * longer one. Typing stops there and the count is shown beside the label, so
   * the limit is met while writing rather than when the bot runs.
   *
   * Only what was typed is counted: what a pill will carry is not known until
   * the Flow runs, and the Runtime is what checks the whole of it then.
   */
  limit?: number
  /**
   * Whether the field is written over several lines. A paragraph is typed into
   * boxes that take a newline; a one-line field is not, because Enter inside a
   * Node's title is a keystroke nobody meant.
   */
  multiline?: boolean
  nodeId: string
  onChange: (value: SlottedText) => void
  /** Whether a Wire feeds this Slot, which is what makes removing it a question. */
  slotIsWired: (slot: string) => boolean
  /** What the pill says: where the value comes from, or that nothing feeds it. */
  slotLabel: (slot: string) => string
  value: SlottedText
}) {
  const editable = editableText(value)
  const boxes = useRef<(SlotBox | null)[]>([])

  const typed = editable.literals.reduce((total, text) => total + text.length, 0)

  /**
   * What one box is allowed to hold after an edit: everything the limit leaves
   * once the other boxes have had their share. Typing past it is cut rather
   * than refused, so a paste that is too long still lands, shortened.
   */
  const cut = (index: number, text: string) => {
    if (limit === undefined) return text
    const elsewhere = typed - (editable.literals[index] ?? "").length
    return text.slice(0, Math.max(limit - elsewhere, 0))
  }

  /** Where the caret goes once React has drawn the field an edit left behind. */
  const [caret, setCaret] = useState<Caret | undefined>(undefined)

  /** The pill the user is being asked about, when they are being asked. */
  const [asking, setAsking] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (caret === undefined) return

    const box = boxes.current[caret.literal]
    box?.focus()
    box?.setSelectionRange(caret.offset, caret.offset)
    setCaret(undefined)
  }, [caret])

  const remove = (index: number) => {
    const removed = withSlotRemoved(editable, index)
    onChange(slottedTextOf(removed.editable))
    setAsking(undefined)
    setCaret(removed.caret)
  }

  /**
   * Removes a pill, asking first when it is the last place its Slot appears and
   * a Wire is feeding it. Another pill of the same Slot still standing means
   * the Port stays and no Wire is at stake, so there is nothing to ask.
   */
  const askThenRemove = (index: number) => {
    const slot = editable.slots[index]
    if (slot === undefined) return

    if (slotOccurrences(editable, slot) === 1 && slotIsWired(slot)) {
      setAsking(index)
      return
    }
    remove(index)
  }

  const moveCaret = (literal: number, offset: number) => {
    const box = boxes.current[literal]
    if (box === null || box === undefined) return
    setCaret({ literal, offset: offset === -1 ? box.value.length : offset })
  }

  const onKeyDown = (index: number) => (event: KeyboardEvent<SlotBox>) => {
    const box = event.currentTarget

    // Every box takes newlines, because every box is the same element; a field
    // that is not a paragraph is the one that turns them down.
    if (event.key === "Enter" && !multiline) {
      event.preventDefault()
      return
    }

    const atStart = box.selectionStart === 0 && box.selectionEnd === 0
    const atEnd = box.selectionStart === box.value.length && box.selectionEnd === box.value.length

    if (event.key === "Backspace" && atStart && index > 0) {
      event.preventDefault()
      askThenRemove(index - 1)
      return
    }
    if (event.key === "Delete" && atEnd && index < editable.slots.length) {
      event.preventDefault()
      askThenRemove(index)
      return
    }
    if (event.key === "ArrowLeft" && atStart && index > 0) {
      event.preventDefault()
      moveCaret(index - 1, -1)
      return
    }
    if (event.key === "ArrowRight" && atEnd && index < editable.slots.length) {
      event.preventDefault()
      moveCaret(index + 1, 0)
    }
  }

  const askedAbout = asking === undefined ? undefined : editable.slots[asking]

  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs" htmlFor={`${nodeId}-${fieldId}`}>
          {label}
        </Label>
        {limit !== undefined && (
          <span
            className={`text-xs tabular-nums ${typed >= limit ? "text-destructive" : "text-muted-foreground"}`}
            data-testid={`field-count-${nodeId}-${fieldId}`}
          >
            {translate("canvas.field.count", { used: String(typed), limit: String(limit) })}
          </span>
        )}
      </div>

      {/*
        The border and the focus ring are drawn here rather than on each text
        box, so that a field holding three boxes and two pills still reads as
        the one control it is.
      */}
      <div
        className="nodrag flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-transparent px-2 py-1 text-sm focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        data-testid={`field-${nodeId}-${fieldId}`}
      >
        {editable.literals.map((text, index) => (
          // A text box is the gap between two pills, and its position in the
          // sentence is the only identity it has.
          // biome-ignore lint/suspicious/noArrayIndexKey: the position is what the gap is.
          <Fragment key={index}>
            {index > 0 && (
              <SlotPill
                fieldId={fieldId}
                index={index - 1}
                label={slotLabel(editable.slots[index - 1] ?? "")}
                nodeId={nodeId}
                onRemove={() => askThenRemove(index - 1)}
              />
            )}
            {/*
              The box grows with what is typed into it: the hidden copy of the
              text underneath is what gives the grid cell its width, and the box
              is stretched over the same cell.
            */}
            <span
              className={[
                "grid min-w-[2ch] [&>*]:col-start-1 [&>*]:row-start-1",
                // A paragraph's box takes the whole width, so its text wraps
                // where the field ends rather than growing past it.
                multiline ? "w-full" : ""
              ].join(" ")}
            >
              <span
                aria-hidden
                className={`invisible ${multiline ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
              >
                {/*
                  A line the user has only just opened has nothing in it to
                  give the cell its height, so the mirror carries a zero-width
                  space at the end and is one line taller than the text is.
                */}
                {multiline ? text + "​" : text}
              </span>
              <textarea
                className="w-full min-w-0 resize-none bg-transparent outline-none"
                data-slot-field={fieldId}
                data-slot-literal={index}
                data-slot-node={nodeId}
                data-testid={`field-box-${nodeId}-${fieldId}-${index}`}
                id={index === 0 ? `${nodeId}-${fieldId}` : undefined}
                onChange={event =>
                  onChange(
                    slottedTextOf(withLiteral(editable, index, cut(index, event.target.value)))
                  )
                }
                onKeyDown={onKeyDown(index)}
                /*
                  Where the caret was is written onto the box, because a Wire
                  dropped on this field arrives long after the box lost focus and
                  the Slot still has to land where the user left off.
                */
                onSelect={event => {
                  event.currentTarget.dataset.slotCaret = String(
                    event.currentTarget.selectionStart ?? 0
                  )
                }}
                ref={box => {
                  boxes.current[index] = box
                }}
                rows={1}
                value={text}
              />
            </span>
          </Fragment>
        ))}
      </div>

      <Dialog onOpenChange={open => !open && setAsking(undefined)} open={asking !== undefined}>
        <DialogContent data-testid="slot-remove-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{translate("canvas.slot.removeWire.title")}</DialogTitle>
            <DialogDescription>
              {translate("canvas.slot.removeWire.body", {
                value: askedAbout === undefined ? "" : slotLabel(askedAbout)
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="slot-remove-cancel"
              onClick={() => setAsking(undefined)}
              variant="outline"
            >
              {translate("canvas.slot.removeWire.cancel")}
            </Button>
            <Button
              data-testid="slot-remove-confirm"
              onClick={() => asking !== undefined && remove(asking)}
              variant="destructive"
            >
              {translate("canvas.slot.removeWire.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** One Slot, drawn where it sits in the sentence. */
function SlotPill({
  fieldId,
  index,
  label,
  nodeId,
  onRemove
}: {
  fieldId: string
  index: number
  label: string
  nodeId: string
  onRemove: () => void
}) {
  return (
    <span
      className="inline-flex select-none items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground text-xs"
      data-testid={`slot-${nodeId}-${fieldId}-${index}`}
    >
      {label}
      <button
        aria-label={translate("canvas.slot.remove")}
        className="text-muted-foreground hover:text-foreground"
        data-testid={`slot-remove-${nodeId}-${fieldId}-${index}`}
        onClick={onRemove}
        type="button"
      >
        ×
      </button>
    </span>
  )
}
