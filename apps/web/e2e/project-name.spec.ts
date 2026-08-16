import { expect, test } from "@playwright/test"
import { MenuBarPage } from "./pages/menu-bar-page"

/**
 * Naming the Project from the Menu Bar, as the user does it: pencil, type,
 * Enter — and the ways back out of it.
 */
test.describe("the Project name", () => {
  let menuBar: MenuBarPage

  test.beforeEach(async ({ page }) => {
    menuBar = new MenuBarPage(page)
    await menuBar.open()
  })

  test("takes the name the user types and shows it in the Menu Bar", async () => {
    await menuBar.editName().click()
    await menuBar.nameField().fill("Moderation bot")
    await menuBar.nameField().press("Enter")

    await expect(menuBar.name()).toHaveText("Moderation bot")
  })

  test("leaves the previous name when the rename is cancelled", async () => {
    const before = await menuBar.name().textContent()

    await menuBar.editName().click()
    await menuBar.nameField().fill("Moderation bot")
    await menuBar.nameField().press("Escape")

    await expect(menuBar.name()).toHaveText(before ?? "")
  })

  test("keeps the name when the user clicks away instead of pressing Enter", async ({ page }) => {
    await menuBar.editName().click()
    await menuBar.nameField().fill("Moderation bot")
    // Anywhere that is not the field: a Node on the Canvas, found by test id so
    // the click does not depend on the language the editor is in.
    await page.getByTestId("node-node-trigger").click()

    await expect(menuBar.name()).toHaveText("Moderation bot")
  })

  test("refuses a blank name and keeps the user in the field", async () => {
    await menuBar.editName().click()
    await menuBar.nameField().fill("   ")
    await menuBar.nameField().press("Enter")

    await expect(menuBar.nameField()).toBeVisible()
  })
})
