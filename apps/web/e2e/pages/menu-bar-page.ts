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
}
