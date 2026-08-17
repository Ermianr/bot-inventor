import type { Locator, Page } from "@playwright/test"

/**
 * The Dashboard: the Projects the application holds, and making another one.
 *
 * It is the application's root screen, so it is also the way into everything
 * else: every other Page Object reaches its screen through `openExample`.
 *
 * Everything is found by test id rather than by its words, because the words
 * are translated and the test would otherwise only pass in English.
 */
export class DashboardPage {
  constructor(private readonly page: Page) {}

  /** Goes to the Dashboard and waits for it to have answered. */
  async open() {
    await this.page.goto("/")
    await this.create().waitFor()
  }

  /** Opens the demonstration Project, and waits for its Canvas to be drawn. */
  async openExample() {
    await this.open()
    await this.example().click()
    await this.page.getByTestId("node-node-trigger").waitFor()
  }

  /** The button in the corner that makes a bot. */
  create(): Locator {
    return this.page.getByTestId("dashboard-create")
  }

  /** The invitation shown when the user has built nothing yet. */
  empty(): Locator {
    return this.page.getByTestId("dashboard-empty")
  }

  /** "Open an example", which only an empty Dashboard offers. */
  example(): Locator {
    return this.page.getByTestId("dashboard-example")
  }

  /**
   * Every card on the Dashboard. Nothing inside a card may carry a test id
   * beginning the same way, or one card would be found as several.
   */
  cards(): Locator {
    return this.page.locator('[data-testid^="project-card-"]')
  }

  /** The name written on a card, whichever card it is. */
  cardNames(): Locator {
    return this.page.getByTestId("card-name")
  }

  /** The dialog that asks for a name, a token and a Test Server. */
  dialog(): Locator {
    return this.page.getByTestId("create-project-dialog")
  }

  name(): Locator {
    return this.page.getByTestId("create-project-name")
  }

  token(): Locator {
    return this.page.getByTestId("create-project-token")
  }

  testServer(): Locator {
    return this.page.getByTestId("create-project-test-server")
  }

  confirm(): Locator {
    return this.page.getByTestId("create-project-confirm")
  }

  /** The menu in the corner of a card: rename, copy, delete. */
  manage(projectId: string): Locator {
    return this.page.getByTestId(`card-manage-${projectId}`)
  }

  rename(projectId: string): Locator {
    return this.page.getByTestId(`card-rename-${projectId}`)
  }

  duplicate(projectId: string): Locator {
    return this.page.getByTestId(`card-duplicate-${projectId}`)
  }

  delete(projectId: string): Locator {
    return this.page.getByTestId(`card-delete-${projectId}`)
  }

  /** The field a Project is renamed in, and the button that does it. */
  renameField(): Locator {
    return this.page.getByTestId("rename-project-name")
  }

  confirmRename(): Locator {
    return this.page.getByTestId("rename-project-confirm")
  }

  /** The dialog that asks before a Project and its token go. */
  deleteDialog(): Locator {
    return this.page.getByTestId("delete-project-dialog")
  }

  confirmDelete(): Locator {
    return this.page.getByTestId("delete-project-confirm")
  }

  /**
   * The id of the only card on the Dashboard. The cards carry it in their test
   * id, which is the one place a spec can learn it: the Project id is made by
   * the application and never shown to the user.
   */
  async onlyProjectId(): Promise<string> {
    const testId = await this.cards().first().getAttribute("data-testid")
    return (testId ?? "").replace("project-card-", "")
  }

  /**
   * Makes a bot the way a user does, and waits to be in the editor. The token
   * is nonsense on purpose: nothing in these specs talks to Discord, and what
   * is being tested is that a Project cannot be made without one.
   */
  async createProject(name: string) {
    await this.create().click()
    await this.name().fill(name)
    await this.token().fill("a-token")
    await this.confirm().click()
    await this.page.getByTestId("project-name").waitFor()
  }
}
