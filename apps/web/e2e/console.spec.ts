import { expect, test } from "@playwright/test"

import { CanvasPage } from "./pages/canvas-page"
import { ConsolePage } from "./pages/console-page"

/**
 * The Console along the bottom of the editor.
 *
 * A bot cannot be run from here — running one needs the desktop shell, and
 * these specs are a plain browser — so what a Session says is held to where the
 * Console is rendered from entries. What only the whole editor can be held to is
 * that the panel is there, along the bottom, and that it gets out of the way
 * when it is asked to and comes back when it is asked again.
 */
test.describe("the Console", () => {
  let canvas: CanvasPage
  let consolePanel: ConsolePage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    consolePanel = new ConsolePage(page)
    await canvas.open()
  })

  test("runs along the bottom of the editor, under the Canvas", async () => {
    await expect(consolePanel.panel()).toBeVisible()
    await expect(consolePanel.output()).toBeVisible()

    const panel = await consolePanel.panel().boundingBox()
    const pane = await canvas.pane().boundingBox()

    expect(panel?.y ?? 0).toBeGreaterThan(pane?.y ?? 0)
  })

  /** One tab today, and a strip rather than a title, so Tracing can join it. */
  test("draws what it holds as a tab strip", async () => {
    await expect(consolePanel.tabs()).toHaveCount(1)
  })

  test("gives the Canvas the whole window when it is collapsed, and comes back", async () => {
    const whole = await canvas.pane().boundingBox()

    await consolePanel.toggle().click()

    await expect(consolePanel.panel()).toHaveAttribute("data-collapsed", "true")
    await expect(consolePanel.output()).toBeHidden()
    expect((await canvas.pane().boundingBox())?.height ?? 0).toBeGreaterThan(whole?.height ?? 0)

    await consolePanel.toggle().click()

    await expect(consolePanel.panel()).toHaveAttribute("data-collapsed", "false")
    await expect(consolePanel.output()).toBeVisible()
  })
})
