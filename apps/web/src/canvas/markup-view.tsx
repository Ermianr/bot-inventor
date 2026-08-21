import type { Block, Inline, MarkupPill } from "@/canvas/discord-markup"
import { type MessageKey, translate } from "@/i18n/messages"

/**
 * What the renderer worked out, on screen.
 *
 * Everything about *what* Discord draws is decided by `discord-markup.ts` and
 * tested there; this file only knows how each answer looks. The colours are
 * tokens rather than Discord's own hexadecimals, so the preview reads in both
 * themes the editor ships.
 */

/** What a Slot's pill says, which is the Flow's answer rather than the text's. */
export type SlotLabel = (slot: string) => string

/** The words a pill the editor cannot resolve is drawn with. */
const PILL_LABEL: Record<MarkupPill["shape"], MessageKey> = {
  mention: "canvas.preview.mention",
  emoji: "canvas.preview.emoji",
  timestamp: "canvas.preview.timestamp"
}

export function MarkupBlocks({
  blocks,
  slotLabel
}: {
  blocks: readonly Block[]
  slotLabel: SlotLabel
}) {
  return blocks.map((block, index) => (
    // A block's place in the text is the only identity it has.
    // biome-ignore lint/suspicious/noArrayIndexKey: the position is what the block is.
    <MarkupBlockView block={block} key={index} slotLabel={slotLabel} />
  ))
}

const HEADING_SIZE: Record<1 | 2 | 3, string> = {
  1: "font-bold text-lg",
  2: "font-bold text-base",
  3: "font-semibold text-sm"
}

function MarkupBlockView({ block, slotLabel }: { block: Block; slotLabel: SlotLabel }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="break-words whitespace-pre-wrap">
          <MarkupInline nodes={block.content} slotLabel={slotLabel} />
        </p>
      )
    case "heading":
      return (
        <p className={`${HEADING_SIZE[block.level]} break-words`}>
          <MarkupInline nodes={block.content} slotLabel={slotLabel} />
        </p>
      )
    case "quote":
      return (
        <blockquote className="border-l-4 border-muted-foreground/40 pl-2">
          <MarkupBlocks blocks={block.content} slotLabel={slotLabel} />
        </blockquote>
      )
    case "list":
      return (
        <ul className="list-inside">
          {block.items.map((item, index) => (
            <li
              className={block.ordered ? "list-decimal" : "list-disc"}
              // biome-ignore lint/suspicious/noArrayIndexKey: the position is what the line is.
              key={index}
              style={{ marginInlineStart: `${item.depth}rem` }}
            >
              <MarkupInline nodes={item.content} slotLabel={slotLabel} />
            </li>
          ))}
        </ul>
      )
    case "codeBlock":
      return (
        <pre className="overflow-x-auto rounded-md border bg-muted p-2 font-mono text-xs">
          <code>
            <MarkupInline nodes={block.content} slotLabel={slotLabel} />
          </code>
        </pre>
      )
  }
}

export function MarkupInline({
  nodes,
  slotLabel
}: {
  nodes: readonly Inline[]
  slotLabel: SlotLabel
}) {
  return nodes.map((node, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the position is what the node is.
    <MarkupInlineView key={index} node={node} slotLabel={slotLabel} />
  ))
}

function MarkupInlineView({ node, slotLabel }: { node: Inline; slotLabel: SlotLabel }) {
  switch (node.kind) {
    case "text":
      return node.text
    case "slot":
      return (
        <span
          className="mx-0.5 inline-flex items-center rounded-sm bg-primary/15 px-1 py-px text-xs font-medium text-primary"
          data-testid="preview-slot"
        >
          {slotLabel(node.slot)}
        </span>
      )
    case "pill":
      return (
        <span
          className="mx-0.5 inline-flex items-center rounded-sm bg-secondary px-1 py-px text-xs text-secondary-foreground"
          data-testid={`preview-pill-${node.shape}`}
        >
          {translate(PILL_LABEL[node.shape])}
        </span>
      )
    case "code":
      return <code className="rounded-sm border bg-muted px-1 font-mono text-xs">{node.text}</code>
    case "link":
      // The preview never leaves the editor, so the link is drawn as a link and
      // does nothing: the user is looking at what the message will say, and a
      // click that opened a browser would be the preview acting as the message.
      return (
        <span className="text-sky-600 underline dark:text-sky-400" title={node.url}>
          <MarkupInline nodes={node.content} slotLabel={slotLabel} />
        </span>
      )
    case "bold":
      return (
        <strong>
          <MarkupInline nodes={node.content} slotLabel={slotLabel} />
        </strong>
      )
    case "italic":
      return (
        <em>
          <MarkupInline nodes={node.content} slotLabel={slotLabel} />
        </em>
      )
    case "underline":
      return (
        <u>
          <MarkupInline nodes={node.content} slotLabel={slotLabel} />
        </u>
      )
    case "strikethrough":
      return (
        <s>
          <MarkupInline nodes={node.content} slotLabel={slotLabel} />
        </s>
      )
    case "spoiler":
      // A spoiler is hidden until it is asked for, the way Discord hides it:
      // showing it here would be the preview telling the user something their
      // readers have to click for.
      return (
        <span
          className="rounded-sm bg-foreground/80 text-transparent hover:bg-transparent hover:text-inherit"
          data-testid="preview-spoiler"
          title={translate("canvas.preview.spoiler")}
        >
          <MarkupInline nodes={node.content} slotLabel={slotLabel} />
        </span>
      )
  }
}
