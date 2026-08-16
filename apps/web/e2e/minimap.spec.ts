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
    await expect(await menu.minimapEntry()).toHaveAttribute("aria-checked", "true")
    await menu.closeMenu()

    await menu.toggleMinimap()

    await expect(await menu.minimapEntry()).toHaveAttribute("aria-checked", "false")
  })

  /**
   * The choice belongs to the person, not to the bot: it is kept beside the
   * browser rather than in the Project, so a reload — which is as close to a
   * restart as a plain browser gets — still finds it.
   */
  test("remembers being turned off", async ({ page }) => {
    await menu.toggleMinimap()
    await expect(canvas.minimap()).toBeHidden()

    await page.reload()
    await canvas.node("node-trigger").waitFor()

    await expect(canvas.minimap()).toBeHidden()
  })
})
