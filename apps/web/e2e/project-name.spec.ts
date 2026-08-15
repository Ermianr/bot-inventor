import { expect, test } from "@playwright/test"
import { ToolbarPage } from "./pages/toolbar-page"

/**
 * Naming the Project from the toolbar, as the user does it: pencil, type,
 * Enter — and the ways back out of it.
 */
test.describe("the Project name", () => {
  let toolbar: ToolbarPage

  test.beforeEach(async ({ page }) => {
    toolbar = new ToolbarPage(page)
    await toolbar.open()
  })

  test("takes the name the user types and shows it in the toolbar", async () => {
    await toolbar.editName().click()
    await toolbar.nameField().fill("Moderation bot")
    await toolbar.nameField().press("Enter")

    await expect(toolbar.name()).toHaveText("Moderation bot")
    await expect(toolbar.unsavedMark()).toBeVisible()
  })

  test("leaves the previous name when the rename is cancelled", async () => {
    const before = await toolbar.name().textContent()

    await toolbar.editName().click()
    await toolbar.nameField().fill("Moderation bot")
    await toolbar.nameField().press("Escape")

    await expect(toolbar.name()).toHaveText(before ?? "")
  })

  test("refuses a blank name and keeps the user in the field", async () => {
    await toolbar.editName().click()
    await toolbar.nameField().fill("   ")
    await toolbar.nameField().press("Enter")

    await expect(toolbar.nameField()).toBeVisible()
  })
})
