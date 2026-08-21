import { expect, test } from "@playwright/test"

import { CanvasPage } from "./pages/canvas-page"
import { MenuBarPage } from "./pages/menu-bar-page"
import { ThemePage } from "./pages/theme-page"

/**
 * The Minimap in the corner of the Canvas, and View ▸ Minimap turning it on and
 * off.
 *
 * A Node that failed in the last Run is not reachable from here — running a bot
 * needs the desktop shell, and these specs are a plain browser — so which of
 * the three colours a Node gets is held to where that decision is made. What
 * only the whole editor can be held to is that the Minimap is on the Canvas,
 * that the menu moves it, and that the answer outlives the page.
 */
test.describe("the Minimap", () => {
  let canvas: CanvasPage
  let menu: MenuBarPage
  let theme: ThemePage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    menu = new MenuBarPage(page)
    theme = new ThemePage(page)
    await canvas.open()
  })

  test("shows the whole Flow in the corner of the Canvas", async () => {
    await expect(canvas.minimap()).toBeVisible()

    // The Flow being edited has a Trigger and a reply, and both are on the map.
    await expect(canvas.minimapNodes()).toHaveCount(2)
  })

  test("draws the Trigger apart from the rest of the Flow", async () => {
    const fills = await canvas
      .minimapNodes()
      .evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fill))

    expect(new Set(fills).size).toBe(2)
  })

  test("is dressed in the application's own tokens and follows the theme", async () => {
    await theme.choose("dark")
    const dark = await theme.paintOf(canvas.minimap())

    await theme.choose("light")
    const light = await theme.paintOf(canvas.minimap())

    // A Node is the yardstick: it is painted from the same tokens, so a Minimap
    // wearing React Flow's own greys instead would not match either theme.
    expect(dark).not.toEqual(light)
    expect(light.surface).toEqual((await theme.paintOf(canvas.node("node-trigger"))).surface)
  })

  test("is turned off from View ▸ Minimap, and on again", async () => {
    await menu.toggleMinimap()
    await expect(canvas.minimap()).toBeHidden()

    await menu.toggleMinimap()
    await expect(canvas.minimap()).toBeVisible()
  })

  test("shows in the menu whether it is on", async () => {
    await menu.openViewMenu()
    await expect(menu.minimapEntry()).toHaveAttribute("aria-checked", "true")
    await menu.closeViewMenu()

    await menu.toggleMinimap()

    await menu.openViewMenu()
    await expect(menu.minimapEntry()).toHaveAttribute("aria-checked", "false")
  })

  /**
   * The choice belongs to the person, not to the bot: it is kept beside the
   * browser rather than in the Project, so a reload — which is as close to a
   * restart as a plain browser gets — still finds it.
   *
   * Both answers are walked, because changing your mind twice is what a user
   * does with a toggle. Only the first of the two can fail on the storage
   * alone — being shown is also what an editor that remembered nothing would
   * do — so which value is written is held to where the entry is.
   */
  test("remembers being turned off", async () => {
    await menu.toggleMinimap()
    await expect(canvas.minimap()).toBeHidden()

    await canvas.reload()

    await expect(canvas.minimap()).toBeHidden()
  })

  test("remembers being turned back on", async () => {
    await menu.toggleMinimap()
    await menu.toggleMinimap()
    await expect(canvas.minimap()).toBeVisible()

    await canvas.reload()

    await expect(canvas.minimap()).toBeVisible()
  })
})
