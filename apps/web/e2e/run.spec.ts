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

  test("puts Play, Reload and Stop on the Menu Bar, with the light beside them", async () => {
    for (const control of [run.start(), run.reload(), run.stop(), run.status()]) {
      await expect(menuBar.row().filter({ has: control })).toBeVisible()
    }
  })

  /**
   * The buttons show no words at all, so their accessible names are the whole
   * of what anybody not looking at the icons is given.
   */
  test("names every button for whoever cannot see the icons", async () => {
    await expect(run.start()).toHaveAttribute("aria-label", /.+/)
    await expect(run.reload()).toHaveAttribute("aria-label", /.+/)
    await expect(run.stop()).toHaveAttribute("aria-label", /.+/)
  })

  test("offers only Play while nothing is running", async () => {
    await expect(run.status()).toHaveAttribute("data-status", "stopped")
    await expect(run.start()).toBeEnabled()
    await expect(run.reload()).toBeDisabled()
    await expect(run.stop()).toBeDisabled()
  })

  /**
   * Nothing is running, so nothing has fallen behind: the word that says a
   * Session is outdated belongs to a bot that is alive.
   */
  test("says nothing about being outdated while nothing is running", async () => {
    await expect(run.outdated()).toBeHidden()
  })

  /**
   * F5 is the browser's own reload, and letting it through would take the
   * Session with it. Whether the browser acts on the key is beyond what a
   * driven browser can be asked — Playwright's F5 never reaches the browser's
   * own chrome — so what the key is swallowed with is pinned where it can be:
   * `run-controls.test.tsx` holds `preventDefault`. What is held here is the
   * other half, and the half a user would notice: the editor is the same
   * window afterwards, still on the same Project, however often F5 is pressed.
   */
  test("stays in the same window, on the same Project, however often F5 is pressed", async ({
    page
  }) => {
    await page.evaluate(() => {
      Object.assign(window, { theWindowTheTestStartedIn: true })
    })

    await run.pressStart()
    await run.pressReload()

    await expect(menuBar.row()).toBeVisible()
    // A reloaded window is a new one, and would not carry the mark.
    expect(await page.evaluate(() => "theWindowTheTestStartedIn" in window)).toBe(true)
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
    await expect(menuBar.row()).toBeVisible()
  })

  /** Shift+F5 is as dead as the Stop button is while there is nothing to stop. */
  test("leaves Shift+F5 alone while nothing is running", async () => {
    await run.pressStop()

    await expect(run.status()).toHaveAttribute("data-status", "stopped")
    await expect(consolePanel.problem()).toBeHidden()
  })
})
