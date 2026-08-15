import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"
import { ToolbarPage } from "./pages/toolbar-page"

/**
 * Putting a Node on the Canvas: the gesture that makes an empty Flow usable.
 *
 * The Node is picked by the words the editor shows it under, so the search is
 * driven with the label rather than with the catalogue id — the id is not text
 * the user has ever seen.
 */
test.describe("adding a Node", () => {
  /**
   * A corner of the Canvas the demonstration Flow's Nodes are nowhere near:
   * the menu belongs to empty Canvas, so a right-click that landed on a Node
   * would be testing something else.
   */
  const empty = { x: 520, y: 80 }

  let canvas: CanvasPage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    await canvas.open()
  })

  test("puts the picked Node where the right-click happened", async () => {
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()

    await canvas.nodeList().getByRole("combobox").fill("Repl")
    await canvas.nodeChoice("discord.interaction.reply").click()

    // The first Node this Flow has ever been given, so it is `node-1`.
    const added = canvas.node("node-1")
    await expect(added).toBeVisible()

    // Where it landed, measured back from the Canvas's own top left. The
    // tolerance is what a fitted, zoomed viewport rounds a point to.
    const box = await added.boundingBox()
    const pane = await canvas.pane().boundingBox()
    expect(Math.abs((box?.x ?? 0) - ((pane?.x ?? 0) + empty.x))).toBeLessThan(20)
    expect(Math.abs((box?.y ?? 0) - ((pane?.y ?? 0) + empty.y))).toBeLessThan(20)
  })

  test("searches and picks with the keyboard alone", async ({ page }) => {
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()

    await page.keyboard.type("Slash")
    await page.keyboard.press("Enter")

    await expect(canvas.node("node-1")).toBeVisible()
  })

  test("says so when nothing in the catalogue matches", async () => {
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()
    await canvas.nodeList().getByRole("combobox").fill("discord.interaction.reply")

    await expect(canvas.nodeList()).toContainText("No node matches that.")
  })

  test("changes nothing when Escape closes the list", async ({ page }) => {
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()
    await expect(canvas.nodeList()).toBeVisible()

    await page.keyboard.press("Escape")

    await expect(canvas.nodeList()).toBeHidden()
    await expect(canvas.node("node-1")).toHaveCount(0)
  })

  test("changes nothing when Escape closes the menu", async ({ page }) => {
    await canvas.rightClickPane(empty)
    await expect(canvas.addNode()).toBeVisible()

    await page.keyboard.press("Escape")

    await expect(canvas.addNode()).toHaveCount(0)
    await expect(canvas.node("node-1")).toHaveCount(0)
  })

  test("offers nothing when the right-click lands on a Node", async () => {
    // The menu belongs to empty Canvas. What a Node offers on a right-click is
    // a later ticket's answer, and until it has one the gesture does nothing.
    await canvas.node("node-trigger").locator("header").click({ button: "right" })

    await expect(canvas.addNode()).toHaveCount(0)
  })

  test("marks the Project as unsaved", async ({ page }) => {
    const toolbar = new ToolbarPage(page)
    await expect(toolbar.unsavedMark()).toHaveCount(0)

    await canvas.rightClickPane(empty)
    await canvas.addNode().click()
    await canvas.nodeChoice("discord.interaction.reply").click()

    await expect(toolbar.unsavedMark()).toBeVisible()
  })
})

/**
 * The same gesture for a user reading the editor in Spanish. A Node is searched
 * for by the words they are shown it under, so in Spanish those words are the
 * Spanish ones — the catalogue id is not text anybody has ever seen, in any
 * language.
 */
test.describe("adding a Node in Spanish", () => {
  test.use({ locale: "es-ES" })

  test("finds a Node by its Spanish name", async ({ page }) => {
    const canvas = new CanvasPage(page)
    await canvas.open()

    await canvas.rightClickPane({ x: 520, y: 80 })
    await page.getByTestId("canvas-add-node").click()
    await canvas.nodeList().getByRole("combobox").fill("Respond")

    await expect(canvas.nodeChoice("discord.interaction.reply")).toBeVisible()
    await canvas.nodeChoice("discord.interaction.reply").click()

    await expect(canvas.node("node-1")).toContainText("Responder")
  })
})
