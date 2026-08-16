import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"

/**
 * Taking a Node off the Canvas: the gesture that undoes adding one.
 *
 * A Wire with an end on the Node goes with it, because a Project holding a Wire
 * that points at a Node that is gone is one the Compiler refuses and the Canvas
 * cannot draw.
 */
test.describe("removing a Node", () => {
  let canvas: CanvasPage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    await canvas.open()
  })

  test("takes the Node and its Wires off the Canvas", async () => {
    // The demonstration Flow's Reply Node is wired to its Trigger.
    await expect(canvas.wires()).toHaveCount(1)

    await canvas.rightClickNode("node-reply")
    await canvas.removeNode("node-reply").click()

    await expect(canvas.node("node-reply")).toHaveCount(0)
    await expect(canvas.wires()).toHaveCount(0)
    // Everything else in the Flow is left exactly as it was.
    await expect(canvas.node("node-trigger")).toBeVisible()
  })

  test("removes a Trigger like any other Node", async () => {
    // Refusing would trap the user with the Trigger they picked first.
    await canvas.rightClickNode("node-trigger")
    await canvas.removeNode("node-trigger").click()

    await expect(canvas.node("node-trigger")).toHaveCount(0)
    await expect(canvas.node("node-reply")).toBeVisible()
    await expect(canvas.wires()).toHaveCount(0)
  })

  test("takes the Wires with it however the Node was removed", async ({ page }) => {
    // The Canvas's own Backspace is the other route, and it goes through the
    // same removal: a Node taken off the screen and left in the Project would
    // still be compiled and still run, with its Wires pointing at nothing.
    await canvas.node("node-reply").locator("header").click()
    await page.keyboard.press("Backspace")

    await expect(canvas.node("node-reply")).toHaveCount(0)
    await expect(canvas.wires()).toHaveCount(0)
    await expect(canvas.node("node-trigger")).toBeVisible()
  })

  test("changes nothing when Escape closes the menu", async ({ page }) => {
    await canvas.rightClickNode("node-reply")
    await expect(canvas.removeNode("node-reply")).toBeVisible()

    await page.keyboard.press("Escape")

    await expect(canvas.removeNode("node-reply")).toHaveCount(0)
    await expect(canvas.node("node-reply")).toBeVisible()
    await expect(canvas.wires()).toHaveCount(1)
  })

  test("puts a Node back on a Flow it was removed from", async () => {
    // The Canvas is usable after a removal: the Flow the user emptied is one
    // they can build again, and the id counting starts from the first free one.
    await canvas.rightClickNode("node-reply")
    await canvas.removeNode("node-reply").click()

    await canvas.rightClickPane({ x: 520, y: 80 })
    await canvas.addNode().click()
    await canvas.nodeChoice("discord.interaction.reply").click()

    await expect(canvas.node("node-1")).toBeVisible()
  })
})

/** The same gesture for a user reading the editor in Spanish. */
test.describe("removing a Node in Spanish", () => {
  test.use({ locale: "es-ES" })

  test("offers the removal in Spanish", async ({ page }) => {
    const canvas = new CanvasPage(page)
    await canvas.open()

    await canvas.rightClickNode("node-reply")

    await expect(canvas.removeNode("node-reply")).toContainText("Eliminar este nodo")
  })
})
