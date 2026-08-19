import type { Locator, Page } from "@playwright/test"

import { DashboardPage } from "./dashboard-page"

/**
 * Running the bot from the Menu Bar, as a test drives it: the three buttons,
 * the light, and the key presses that stand in for them.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class RunPage {
  constructor(private readonly page: Page) {}

  async open() {
    await new DashboardPage(this.page).openExample()
    await this.start().waitFor()
  }

  /** Play: the button that puts the bot on Discord. */
  start(): Locator {
    return this.page.getByTestId("run-start")
  }

  /** Stop: the button that takes it off again. */
  stop(): Locator {
    return this.page.getByTestId("run-stop")
  }

  /** Reload: the button that puts the Project in place of the running bot. */
  reload(): Locator {
    return this.page.getByTestId("run-reload")
  }

  /** The word that says the running bot has fallen behind the Project. */
  outdated(): Locator {
    return this.page.getByTestId("run-outdated")
  }

  /** The light, which carries which of the four things the bot is doing. */
  status(): Locator {
    return this.page.getByTestId("run-status")
  }

  /** F5, the way a user starts a Session without reaching for the mouse. */
  async pressStart() {
    await this.page.keyboard.press("F5")
  }

  /** F5 again, which is what asks a running bot to catch up. */
  async pressReload() {
    await this.page.keyboard.press("F5")
  }

  /** Shift+F5, the same for stopping one. */
  async pressStop() {
    await this.page.keyboard.press("Shift+F5")
  }
}
