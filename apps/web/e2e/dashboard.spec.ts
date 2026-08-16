import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"
import { DashboardPage } from "./pages/dashboard-page"
import { MenuBarPage } from "./pages/menu-bar-page"

/**
 * The path from opening the application to having a Project that saves itself.
 *
 * These specs run in a plain browser, against the browser-backed side of the
 * same port the desktop shell puts a folder behind. Nothing here knows where a
 * Project physically lands, which is the point: what the user is promised is
 * that the work is there when they come back, not that it is in any one place.
 */
test.describe("the Dashboard", () => {
  let dashboard: DashboardPage

  test.beforeEach(async ({ page }) => {
    dashboard = new DashboardPage(page)
    await dashboard.open()
  })

  test("is the first thing the user sees, and invites them to build something", async () => {
    await expect(dashboard.empty()).toBeVisible()
    await expect(dashboard.cards()).toHaveCount(0)
  })

  test("makes a Project without asking where to put it, and opens it", async ({ page }) => {
    await dashboard.create().click()
    await expect(dashboard.dialog()).toBeVisible()

    await dashboard.name().fill("Moderation bot")
    await dashboard.token().fill("a-token")
    await dashboard.testServer().fill("123456789")
    await dashboard.confirm().click()

    // In the editor, on a Canvas of their own, at a route carrying the Project.
    await expect(new MenuBarPage(page).name()).toHaveText("Moderation bot")
    expect(page.url()).toContain("/projects/")
  })

  /**
   * A Project without a token opens onto a Run button that cannot work. The
   * button being dead is how the dialog says so before anything is built.
   */
  test("refuses to make a Project without a token", async () => {
    await dashboard.create().click()
    await dashboard.name().fill("Moderation bot")

    await expect(dashboard.confirm()).toBeDisabled()

    await dashboard.token().fill("a-token")
    await expect(dashboard.confirm()).toBeEnabled()
  })

  test("lists the Projects that were made, and opens one from its card", async ({ page }) => {
    await dashboard.createProject("Moderation bot")
    await new MenuBarPage(page).goToDashboard()
    await dashboard.createProject("Welcome bot")
    await new MenuBarPage(page).goToDashboard()

    await expect(dashboard.cards()).toHaveCount(2)

    await dashboard.cardNames().filter({ hasText: "Moderation bot" }).click()
    await expect(new MenuBarPage(page).name()).toHaveText("Moderation bot")
  })
})

test.describe("a Project that saves itself", () => {
  test("keeps a change on the Canvas through a reload, with no save", async ({ page }) => {
    const canvas = new CanvasPage(page)
    await canvas.open()

    await canvas.field("node-trigger", "name").fill("goodbye")
    // Off the field, which is when the editor is told what was typed. Nothing
    // else is pressed: there is nothing else to press.
    await canvas.pane().click()

    await canvas.reload()

    await expect(canvas.field("node-trigger", "name")).toHaveValue("goodbye")
  })

  test("shows the Flow exactly as it was left when the Project is reopened", async ({ page }) => {
    const canvas = new CanvasPage(page)
    const menuBar = new MenuBarPage(page)
    const dashboard = new DashboardPage(page)
    await canvas.open()

    await canvas.rightClickNode("node-reply")
    await canvas.removeNode("node-reply").click()
    await expect(canvas.node("node-reply")).toHaveCount(0)

    await menuBar.waitUntilSaved()
    await menuBar.goToDashboard()
    await expect(dashboard.cards()).toHaveCount(1)
    await dashboard.cards().first().click()

    await canvas.node("node-trigger").waitFor()
    await expect(canvas.node("node-reply")).toHaveCount(0)
  })

  /**
   * Real navigation rather than a screen swapped in place: the editor lives at
   * a route of its own, so the browser's own way back is the way back.
   */
  test("returns to the Dashboard with the back button", async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.open()
    await dashboard.createProject("Moderation bot")

    await page.goBack()

    await expect(dashboard.cards()).toHaveCount(1)
  })
})
