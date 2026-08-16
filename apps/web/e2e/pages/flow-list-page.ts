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

  /** The bin that asks whether a Flow should go. */
  remove(flowId: string): Locator {
    return this.page.getByTestId(`flow-${flowId}-remove`)
  }

  /** The bin on whichever Flow is open, whose id a test may not know. */
  removeOpen(): Locator {
    return this.page.locator('li[aria-current="true"] [data-testid$="-remove"]')
  }

  /** The question a removal puts before it happens. */
  removeDialog(): Locator {
    return this.page.getByTestId("remove-flow-dialog")
  }

  /** The button that goes through with a removal. */
  confirmRemoval(): Locator {
    return this.page.getByTestId("remove-flow-confirm")
  }

  /** The button that calls the removal off. */
  cancelRemoval(): Locator {
    return this.page.getByTestId("remove-flow-cancel")
  }

  /** The mark saying a Flow has nothing to start it, and so never runs. */
  neverRuns(flowId: string): Locator {
    return this.page.getByTestId(`flow-${flowId}-never-runs`)
  }

  /** The same mark on whichever Flow is open, whose id a test may not know. */
  neverRunsOpen(): Locator {
    return this.page.locator('li[aria-current="true"] [data-testid$="-never-runs"]')
  }

  /** Every Flow's name, in the order the list holds them. */
  names(): Locator {
    return this.page.locator(
      '[data-testid^="flow-"]:not([data-testid$="-edit"], [data-testid$="-field"], [data-testid$="-remove"], [data-testid$="-never-runs"], [data-testid="flow-create"])'
    )
  }

  /**
   * Whichever name is currently a field. A Flow the test has just created is
   * found this way because its id is a UUID the test cannot know.
   */
  openField(): Locator {
    return this.page.locator('[data-testid^="flow-"][data-testid$="-field"]')
  }

  /** A whole row, which is what the controls on it are coloured against. */
  row(flowId: string): Locator {
    return this.page.locator(`li:has([data-testid="flow-${flowId}"])`)
  }

  /**
   * Whatever explanation the editor is currently showing under the pointer.
   *
   * Found by the slot the tooltip component names itself with rather than by a
   * role: the popup is a plain element, since what it says is already the
   * accessible name of the control it belongs to. Only the open one counts —
   * the one the pointer just left is still on the page while it fades.
   */
  tooltip(): Locator {
    return this.page.locator('[data-slot="tooltip-content"][data-open]')
  }

  /** Whatever the editor is saying about a refused rename. */
  toast(): Locator {
    return this.page.locator("[data-sonner-toast]")
  }
}
