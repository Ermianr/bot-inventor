import type { Locator, Page } from "@playwright/test"

import { DashboardPage } from "./dashboard-page"

/**
 * The Menu Bar: what the Project is called, and the way back to the Dashboard.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class MenuBarPage {
  constructor(private readonly page: Page) {}

  async open() {
    await new DashboardPage(this.page).openExample()
    await this.name().waitFor()
  }

  /** The Project name as it is read, when it is not being edited. */
  name(): Locator {
    return this.page.getByTestId("project-name")
  }

  /** The pencil that turns the name into a field. */
  editName(): Locator {
    return this.page.getByTestId("project-name-edit")
  }

  /** The name as a field, once the pencil has been pressed. */
  nameField(): Locator {
    return this.page.getByTestId("project-name-field")
  }

  /**
   * The row itself, which carries whether the Canvas has reached storage.
   *
   * Autosave waits a moment before it writes, so a test that reloads the
   * instant it has typed reloads before the write. Nothing is drawn about it —
   * there is nothing the user could do — so the row says it as an attribute and
   * this is what a spec waits on instead of a guess at how long is enough.
   */
  async waitUntilSaved() {
    await this.page.locator("[data-saved]").first().waitFor()
    await this.page.waitForFunction(
      () => document.querySelector("[data-saved]")?.getAttribute("data-saved") === "true"
    )
  }

  /** Opens the Project menu, and waits for what hangs under it to be there. */
  async openProjectMenu() {
    await this.page.getByTestId("menu-project").click()
    await this.dashboardEntry().waitFor()
  }

  /** Project ▸ the way back to the Dashboard. */
  dashboardEntry(): Locator {
    return this.page.getByTestId("menu-dashboard")
  }

  /** Goes back to the Dashboard through the menu, the way a user does. */
  async goToDashboard() {
    await this.openProjectMenu()
    await this.dashboardEntry().click()
    await waitForMenuToClose(this.dashboardEntry())
  }

  /** Opens the View menu, and waits for what hangs under it to be there. */
  async openViewMenu() {
    await this.page.getByTestId("menu-view").click()
    await this.minimapEntry().waitFor()
  }

  /** View ▸ Minimap, which is only on the screen while View is open. */
  minimapEntry(): Locator {
    return this.page.getByTestId("menu-minimap")
  }

  /** Ticks or unticks View ▸ Minimap, and waits for the menu to be gone. */
  async toggleMinimap() {
    await this.openViewMenu()
    await this.minimapEntry().click()
    await waitForMenuToClose(this.minimapEntry())
  }

  /** Leaves the View menu without choosing anything from it. */
  async closeViewMenu() {
    await this.page.keyboard.press("Escape")
    await waitForMenuToClose(this.minimapEntry())
  }
}

/**
 * Waits for a menu to be off the screen, given anything that was inside it.
 *
 * A menu that has been chosen from is animating out, and it is still on the
 * screen while it does: the next thing a test does would otherwise land on the
 * copy that is on its way off. Every Page Object driving the Menu Bar needs
 * this, so it lives beside them rather than in each of them.
 */
export async function waitForMenuToClose(inside: Locator) {
  await inside.waitFor({ state: "detached" })
}
