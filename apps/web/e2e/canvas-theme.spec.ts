import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"
import { ThemePage } from "./pages/theme-page"

/**
 * The Canvas controls under both themes. React Flow dresses them from its own
 * stylesheet, so what is checked here is that they are wearing the
 * application's tokens instead — a Node is the yardstick, because it is painted
 * from the same ones.
 */
test.describe("the Canvas controls", () => {
  let canvas: CanvasPage
  let theme: ThemePage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    theme = new ThemePage(page)
    await canvas.open()
  })

  test("are dressed like a Node, and follow the theme without a reload", async () => {
    const button = canvas.controlButtons().first()
    const node = canvas.node("node-trigger")

    await theme.choose("dark")
    const dark = await theme.paintOf(button)
    expect(dark).toEqual(await theme.paintOf(node))

    await theme.choose("light")
    const light = await theme.paintOf(button)
    expect(light).toEqual(await theme.paintOf(node))

    // The two themes are genuinely different, so following one is worth saying.
    expect(light).not.toEqual(dark)
  })
})
