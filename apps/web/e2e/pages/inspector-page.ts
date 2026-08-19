import type { Locator, Page } from "@playwright/test"

/**
 * The panel beside the Canvas, as a test drives it: the fields of a Node too
 * big to draw on the Canvas, and the preview of the message it builds.
 *
 * The preview is addressed part by part rather than as one block of text,
 * because what the tests are about is *where* Discord renders formatting and
 * where it does not: a title that quietly went bold reads the same as a title
 * that did not, once both are flattened into one string.
 */
export class InspectorPage {
  constructor(private readonly page: Page) {}

  /** The panel itself, open for one Node. */
  panel(nodeId: string): Locator {
    return this.page.getByTestId(`inspector-${nodeId}`)
  }

  /** The Embed as the message will look, once there is anything to draw. */
  preview(): Locator {
    return this.page.getByTestId("embed-preview")
  }

  /** What stands in for the preview while the Embed is still empty. */
  empty(): Locator {
    return this.page.getByTestId("embed-preview-empty")
  }

  /** One part of the drawn Embed — its title, its description, its footer. */
  part(name: string): Locator {
    return this.page.getByTestId(`embed-preview-${name}`)
  }

  /** Every pair drawn inside the Embed, in the order they are laid out. */
  embedFields(): Locator {
    return this.part("embedFields").locator("> *")
  }

  /** Every Slot the preview drew as a pill, because no Run has filled it. */
  slots(): Locator {
    return this.preview().getByTestId("preview-slot")
  }

  /**
   * Every mention, custom emoji or Discord timestamp, drawn as the neutral pill
   * the editor can honestly draw: it is not connected to Discord and cannot say
   * whose name or which picture any of them stands for.
   */
  pills(shape: "mention" | "emoji" | "timestamp"): Locator {
    return this.preview().getByTestId(`preview-pill-${shape}`)
  }

  /** Text Discord keeps hidden until a reader asks for it. */
  spoilers(): Locator {
    return this.preview().getByTestId("preview-spoiler")
  }

  /** The one line the Canvas draws for a Node that is typed into here. */
  summary(nodeId: string): Locator {
    return this.page.getByTestId(`node-summary-${nodeId}`)
  }

  /** The bar down the side of that line, in the colour the Embed holds. */
  summaryColour(nodeId: string): Locator {
    return this.page.getByTestId(`node-summary-colour-${nodeId}`)
  }

  /** The control that adds a pair to the Embed. */
  addEmbedField(nodeId: string, fieldId: string): Locator {
    return this.page.getByTestId(`embed-field-add-${nodeId}-${fieldId}`)
  }

  /** The switch that lays one pair beside its neighbours. */
  inlineEmbedField(nodeId: string, fieldId: string, index: number): Locator {
    return this.page.getByTestId(`embed-field-inline-${nodeId}-${fieldId}-${index}`)
  }
}
