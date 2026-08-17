import { expect, test } from "@playwright/test"

import { ConsolePage } from "./pages/console-page"
import { MenuBarPage } from "./pages/menu-bar-page"
import { RunPage } from "./pages/run-page"

/**
 * Running the bot from the Menu Bar.
 *
 * A bot cannot actually reach Discord from here — starting one needs the
 * desktop shell, and these specs are a plain browser — so what is held to is
 * everything around the bot: which button is offered when, what the light says,
 * that F5 and Shift+F5 reach the same two things the buttons do, and that a
 * Session that could not start explains itself in the Console instead of going
 * quiet.
 */
test.describe("running the bot", () => {
  let run: RunPage
  let menuBar: MenuBarPage
  let consolePanel: ConsolePage

  test.beforeEach(async ({ page }) => {
    run = new RunPage(page)
    menuBar = new MenuBarPage(page)
    consolePanel = new ConsolePage(page)
    await run.open()
  })

  test("puts Play and Stop on the Menu Bar, with the light beside them", async () => {
    for (const control of [run.start(), run.stop(), run.status()]) {
      await expect(menuBar.row().filter({ has: control })).toBeVisible()
    }
  })

  /**
   * The buttons show no words at all, so their accessible names are the whole
   * of what anybody not looking at the icons is given.
   */
  test("names both buttons for whoever cannot see the icons", async () => {
    await expect(run.start()).toHaveAttribute("aria-label", /.+/)
    await expect(run.stop()).toHaveAttribute("aria-label", /.+/)
  })

  test("offers only Play while nothing is running", async () => {
    await expect(run.status()).toHaveAttribute("data-status", "stopped")
    await expect(run.start()).toBeEnabled()
    await expect(run.stop()).toBeDisabled()
  })

  test("says why a Session could not start, in the Console", async () => {
    await run.start().click()

    await expect(run.status()).toHaveAttribute("data-status", "failed")
    await expect(consolePanel.problem()).toBeVisible()
  })

  /**
   * The key and the button are two ways of asking for one thing, so the light
   * moves the same way whichever was used. F5 is the browser's own reload as
   * well — the editor takes it, and the Project is still open afterwards.
   */
  test("starts a Session on F5", async () => {
    await run.pressStart()

    await expect(run.status()).toHaveAttribute("data-status", "failed")
    await expect(consolePanel.problem()).toBeVisible()
    await expect(menuBar.name()).toBeVisible()
  })

  /** Shift+F5 is as dead as the Stop button is while there is nothing to stop. */
  test("leaves Shift+F5 alone while nothing is running", async () => {
    await run.pressStop()

    await expect(run.status()).toHaveAttribute("data-status", "stopped")
    await expect(consolePanel.problem()).toBeHidden()
  })
})
