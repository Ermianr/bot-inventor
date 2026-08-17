import type { Locator, Page } from "@playwright/test"

/**
 * The Console along the bottom of the editor, as a test drives it.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class ConsolePage {
  constructor(private readonly page: Page) {}

  /** The panel itself, which says whether it is collapsed. */
  panel(): Locator {
    return this.page.getByTestId("console")
  }

  /** The one control that both hides the Console and brings it back. */
  toggle(): Locator {
    return this.page.getByTestId("console-collapse")
  }

  /** The tabs of the strip. Tracing joins them later; today there is one. */
  tabs(): Locator {
    return this.page.getByRole("tab")
  }

  /** What the Session has said, when the Console is showing it. */
  output(): Locator {
    return this.page.getByTestId("session-output")
  }
}
