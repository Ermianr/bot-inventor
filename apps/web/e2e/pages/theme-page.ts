import type { Locator, Page } from "@playwright/test"

/**
 * The theme the user chose, as a test changes it: the menu in the header and
 * the two themes it offers.
 */
/** The three colours a surface in this application is made of. */
type Paint = { surface: string; border: string; ink: string }

export class ThemePage {
  constructor(private readonly page: Page) {}

  async choose(theme: "light" | "dark") {
    await this.page.getByTestId("theme-toggle").click()
    await this.page.getByTestId(`theme-${theme}`).click()
    await this.page.locator(`html.${theme}`).waitFor()
  }

  /**
   * The colours something is actually painted in, once the browser has resolved
   * whatever tokens it was written with.
   */
  paintOf(locator: Locator): Promise<Paint> {
    return locator.evaluate(element => {
      const style = getComputedStyle(element)
      return {
        surface: style.backgroundColor,
        border: style.borderBottomColor,
        ink: style.color
      }
    })
  }
}
