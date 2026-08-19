import { type NodeFields, readEmbedFields } from "@bot-inventor/nodes"
import { readSlottedText, type SlottedText } from "@bot-inventor/schema"
import { colourHex } from "@/canvas/colour"
import { formattedText, plainText } from "@/canvas/discord-markup"
import { MarkupBlocks, MarkupInline, type SlotLabel } from "@/canvas/markup-view"
import { translate } from "@/i18n/messages"

/**
 * The Embed a Node is holding, drawn as the message will look.
 *
 * It renders Discord's formatting where Discord renders it and leaves it
 * standing where Discord does not — the title, the footer and the name of an
 * Embed Field are flat text over there, and a preview that prettied them up
 * would be a preview worth less than no preview at all.
 *
 * Nothing here is invented. A Slot no Run has filled is drawn as the pill it
 * is, a mention is a pill of the shape a mention has, and neither is given a
 * name the editor cannot know: the editor is not connected to Discord.
 */
export function EmbedPreview({
  fields,
  slotLabel,
  slotValue
}: {
  fields: NodeFields
  /** What a Slot no Run has filled says, which is where its value comes from. */
  slotLabel: SlotLabel
  /** What the most recent Run carried into a Slot, when there has been one. */
  slotValue: (slot: string) => string | undefined
}) {
  const text = (fieldId: string) => filled(readSlottedText(fields[fieldId]), slotValue)
  const written = (fieldId: string) => flat(text(fieldId))

  const title = text("title")
  const description = text("description")
  const authorName = text("authorName")
  const footerText = text("footerText")
  const embedFields = readEmbedFields(fields.embedFields)
  const image = written("image")
  const thumbnail = written("thumbnail")
  const stamped = fields.timestamp === true

  const empty =
    title.length === 0 &&
    description.length === 0 &&
    authorName.length === 0 &&
    footerText.length === 0 &&
    embedFields.length === 0 &&
    image.length === 0 &&
    thumbnail.length === 0

  if (empty) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="embed-preview-empty">
        {translate("canvas.preview.empty")}
      </p>
    )
  }

  return (
    // The bar down the side is what an Embed is recognised by, and it is drawn
    // from the same integer the Project stores and the bot will send.
    <div
      className="max-w-md overflow-hidden rounded-md border-l-4 bg-muted/40 p-3 text-sm"
      data-testid="embed-preview"
      style={{ borderLeftColor: colourHex(fields.colour) }}
    >
      <div className="flex gap-3">
        <div className="grid min-w-0 flex-1 gap-2">
          {authorName.length > 0 && (
            <div className="flex items-center gap-2" data-testid="embed-preview-author">
              <PreviewPicture
                className="h-6 w-6 rounded-full"
                testId="embed-preview-authorIcon"
                url={written("authorIcon")}
              />
              {/* Discord renders no formatting on an author's name either. */}
              <span className="truncate font-semibold text-xs">
                <MarkupInline nodes={plainText(authorName)} slotLabel={slotLabel} />
              </span>
            </div>
          )}

          {title.length > 0 && (
            <p
              className={`font-semibold ${written("url").length > 0 ? "text-sky-600 dark:text-sky-400" : ""}`}
              data-testid="embed-preview-title"
            >
              <MarkupInline nodes={plainText(title)} slotLabel={slotLabel} />
            </p>
          )}

          {description.length > 0 && (
            <div className="grid gap-1" data-testid="embed-preview-description">
              <MarkupBlocks blocks={formattedText(description)} slotLabel={slotLabel} />
            </div>
          )}

          {embedFields.length > 0 && (
            /*
              Discord lays the pairs out in a grid and a pair marked inline
              takes a third of it; a pair that is not takes the whole width and
              ends the row. That is the layout the user is arranging, so it is
              the layout the preview has to show.
            */
            <div className="grid grid-cols-3 gap-2" data-testid="embed-preview-embedFields">
              {embedFields.map((embedField, index) => (
                <div
                  className={`grid min-w-0 gap-0.5 ${embedField.inline ? "" : "col-span-3"}`}
                  data-inline={embedField.inline}
                  // A pair has no identity but the place it was put in.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the position is what the pair is.
                  key={index}
                >
                  <p className="font-semibold text-xs">
                    <MarkupInline
                      nodes={plainText(filled(embedField.name, slotValue))}
                      slotLabel={slotLabel}
                    />
                  </p>
                  <div className="text-xs">
                    <MarkupBlocks
                      blocks={formattedText(filled(embedField.value, slotValue))}
                      slotLabel={slotLabel}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <PreviewPicture
            className="max-h-48 w-full rounded-md object-cover"
            testId="embed-preview-image"
            url={image}
          />

          {(footerText.length > 0 || stamped) && (
            <div
              className="flex items-center gap-2 text-muted-foreground text-xs"
              data-testid="embed-preview-footer"
            >
              <PreviewPicture
                className="h-5 w-5 rounded-full"
                testId="embed-preview-footerIcon"
                url={written("footerIcon")}
              />
              {/* Discord renders no formatting in a footer. */}
              <span className="truncate">
                <MarkupInline nodes={plainText(footerText)} slotLabel={slotLabel} />
              </span>
              {/*
                The time is the time the message is sent, which no preview can
                know, so what is shown is that there will be one.
              */}
              {stamped && (
                <span data-testid="embed-preview-timestamp">
                  {footerText.length > 0 ? "• " : ""}
                  {translate("canvas.preview.sentAt")}
                </span>
              )}
            </div>
          )}
        </div>

        <PreviewPicture
          className="h-16 w-16 shrink-0 rounded-md object-cover"
          testId="embed-preview-thumbnail"
          url={thumbnail}
        />
      </div>
    </div>
  )
}

/**
 * A picture an Embed carries, or nothing when no address was typed.
 *
 * The address may be a Slot no Run has filled, and there is no picture to draw
 * for a value that has not arrived: the frame is drawn empty rather than the
 * preview picking an image to stand in for it.
 */
function PreviewPicture({
  className,
  testId,
  url
}: {
  className: string
  testId: string
  url: string
}) {
  if (url.length === 0) return null

  return (
    // The address is whatever the user typed, so the picture may well not load.
    // The frame stays either way: something is there, and that is the fact the
    // preview is reporting.
    // biome-ignore lint/performance/noImgElement: the editor is not a framework with an image component.
    <img
      alt=""
      className={`${className} border bg-muted`}
      data-testid={testId}
      loading="lazy"
      src={url}
    />
  )
}

/**
 * The text with the values the most recent Run carried put where their Slots
 * are. A Slot no Run has filled is left as a Slot, and the preview draws the
 * pill for it: an invented sample value would be the one lie a preview must
 * never tell.
 */
function filled(
  segments: SlottedText,
  slotValue: (slot: string) => string | undefined
): SlottedText {
  return segments.map(segment => {
    if (segment.kind !== "slot") return segment
    const value = slotValue(segment.slot)
    return value === undefined ? segment : { kind: "literal", text: value }
  })
}

/** The plain characters of a field, which is all an address of a picture is. */
function flat(segments: SlottedText): string {
  return segments.map(segment => (segment.kind === "literal" ? segment.text : "")).join("")
}
