import { expect, test } from "@playwright/test"
import { AboutPage } from "./pages/about-page"
import { MenuBarPage } from "./pages/menu-bar-page"

/**
 * Help ▸ About: what the user is running, and the two ways out of the dialog.
 *
 * These specs run in a plain browser, where the version and the Sidecar's
 * Node.js are things nothing can answer — so what is held to here is that every
 * line is on the screen and that the dialog behaves like a dialog. What each
 * line says is covered by the component test.
 */
test.describe("About", () => {
  let about: AboutPage

  test.beforeEach(async ({ page }) => {
    await new MenuBarPage(page).open()
    about = new AboutPage(page)
    await about.open()
  })

  test("says what the application is and which one the user has", async () => {
    for (const fact of ["version", "licence", "node", "repository"] as const) {
      await expect(about.fact(fact)).toBeVisible()
    }
  })

  test("is dismissed with Escape", async ({ page }) => {
    await page.keyboard.press("Escape")

    await expect(about.dialog()).toBeHidden()
  })

  test("is dismissed by clicking away from it", async ({ page }) => {
    // The corner of the window, which is as far from a dialog in the middle of
    // it as a click can land.
    await page.mouse.click(5, 5)

    await expect(about.dialog()).toBeHidden()
  })
})
