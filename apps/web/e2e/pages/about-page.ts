import type { Locator, Page } from "@playwright/test"

/**
 * About, as a test opens and dismisses it: Help ▸ About, and what the dialog
 * says once it is there.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class AboutPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.getByTestId("menu-help").click()
    await this.page.getByTestId("menu-about").click()
    await this.dialog().waitFor()
  }

  dialog(): Locator {
    return this.page.getByTestId("about-dialog")
  }

  /** One of the things About has to say, by the name this page knows it under. */
  fact(name: "version" | "licence" | "node" | "project" | "repository"): Locator {
    return this.page.getByTestId(`about-${name}`)
  }
}
