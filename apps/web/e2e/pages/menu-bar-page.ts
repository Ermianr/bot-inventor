import type { Locator, Page } from "@playwright/test"

/**
 * The Menu Bar: what the Project is called, and whether the file on disk is out
 * of date.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class MenuBarPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/")
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

  /** The mark saying the file on disk is behind what is on the Canvas. */
  unsavedMark(): Locator {
    return this.page.getByTestId("project-unsaved")
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
