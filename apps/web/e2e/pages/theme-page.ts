import type { Locator, Page } from "@playwright/test"

/** The three colours a surface in this application is made of. */
type Paint = { surface: string; border: string; ink: string }

/**
 * The theme the user chose, as a test changes it: View ▸ Theme, and the themes
 * it offers.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class ThemePage {
  constructor(private readonly page: Page) {}

  async choose(theme: "light" | "dark") {
    await this.page.getByTestId("menu-view").click()

    // Hovered rather than clicked: a submenu opens on hover, and the closing
    // menu of a previous choice is still animating out under the pointer, so a
    // click can land on the copy that is on its way off the screen.
    await this.page.getByTestId("menu-theme").hover()
    await this.page.getByTestId(`theme-${theme}`).click()
    await this.page.locator(`html.${theme}`).waitFor()

    // The menu is animating out at this point, and it is still on the screen
    // while it does. Waiting for it to be gone leaves the bar in a state the
    // next choice can open from.
    await this.page.getByTestId("menu-theme").waitFor({ state: "detached" })
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
