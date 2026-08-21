import type { NodeFields, NodeSummary } from "@bot-inventor/nodes"
import { readSlottedText } from "@bot-inventor/schema"

import { colourHex } from "@/canvas/colour"
import { plainText } from "@/canvas/discord-markup"
import { MarkupInline, type SlotLabel } from "@/canvas/markup-view"
import { translate } from "@/i18n/messages"

/**
 * A Node whose fields are typed into the Inspector, as the Canvas draws it: the
 * bar in the colour it holds and the one line of text that says which Node it
 * is.
 *
 * The title is drawn as flatly as Discord draws it — no formatting, because
 * Discord renders none there — so the Canvas and the preview agree with each
 * other about the same words.
 */
export function NodeSummaryRow({
  fields,
  nodeId,
  slotLabel,
  summary
}: {
  fields: NodeFields
  nodeId: string
  slotLabel: SlotLabel
  summary: NodeSummary
}) {
  const title = plainText(readSlottedText(fields[summary.titleField]))

  return (
    <div className="flex items-center gap-2" data-testid={`node-summary-${nodeId}`}>
      {summary.colourField !== undefined && (
        <span
          className="h-8 w-1 shrink-0 rounded-full"
          data-testid={`node-summary-colour-${nodeId}`}
          style={{ backgroundColor: colourHex(fields[summary.colourField]) }}
        />
      )}
      <p className="min-w-0 flex-1 truncate text-sm">
        {title.length === 0 ? (
          <span className="text-muted-foreground">{translate("canvas.summary.untitled")}</span>
        ) : (
          <MarkupInline nodes={title} slotLabel={slotLabel} />
        )}
      </p>
    </div>
  )
}
