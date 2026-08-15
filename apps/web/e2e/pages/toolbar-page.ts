import type { Locator, Page } from "@playwright/test"

/**
 * The Project toolbar: what the Project is called, and whether the file behind
 * it is behind.
 */
export class ToolbarPage {
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
    return this.page.getByText("Unsaved")
  }
}
