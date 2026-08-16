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

  /** View ▸ Minimap, as the entry itself, with the View menu opened for it. */
  async minimapEntry(): Promise<Locator> {
    await this.page.getByTestId("menu-view").click()
    const entry = this.page.getByTestId("menu-minimap")
    await entry.waitFor()
    return entry
  }

  /** Ticks or unticks View ▸ Minimap, and waits for the menu to be gone. */
  async toggleMinimap() {
    const entry = await this.minimapEntry()
    await entry.click()

    // The menu is animating out at this point, and it is still on the screen
    // while it does. Waiting for it to be gone leaves the bar in a state the
    // next thing the test does can open from.
    await entry.waitFor({ state: "detached" })
  }

  /** Closes whatever menu is open, without choosing anything from it. */
  async closeMenu() {
    await this.page.keyboard.press("Escape")
    await this.page.getByTestId("menu-minimap").waitFor({ state: "detached" })
  }
}
