import type { Locator, Page } from "@playwright/test"

/**
 * The Flow list: which Flows the Project has, which one is open, and renaming
 * one of them.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English. A refused
 * rename is found by the toast element itself for the same reason.
 */
export class FlowListPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/")
    await this.name("flow-hello").waitFor()
  }

  /** A Flow's name in the list, which is also how that Flow is opened. */
  name(flowId: string): Locator {
    return this.page.getByTestId(`flow-${flowId}`)
  }

  /** The pencil that turns a Flow's name into a field. */
  editName(flowId: string): Locator {
    return this.page.getByTestId(`flow-${flowId}-edit`)
  }

  /** A Flow's name as a field, once the pencil has been pressed. */
  nameField(flowId: string): Locator {
    return this.page.getByTestId(`flow-${flowId}-field`)
  }

  /** The "+" that adds a Flow. */
  create(): Locator {
    return this.page.getByTestId("flow-create")
  }

  /** Every Flow's name, in the order the list holds them. */
  names(): Locator {
    return this.page.locator(
      '[data-testid^="flow-"]:not([data-testid$="-edit"], [data-testid$="-field"], [data-testid="flow-create"])'
    )
  }

  /**
   * Whichever name is currently a field. A Flow the test has just created is
   * found this way because its id is a UUID the test cannot know.
   */
  openField(): Locator {
    return this.page.locator('[data-testid^="flow-"][data-testid$="-field"]')
  }

  /** Whatever the editor is saying about a refused rename. */
  toast(): Locator {
    return this.page.locator("[data-sonner-toast]")
  }
}
