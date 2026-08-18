import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"

/**
 * The Canvas as the user meets it: the Flow they opened, drawn, and the Wires
 * they are and are not allowed to draw on it.
 */
test.describe("the Canvas", () => {
  let canvas: CanvasPage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    await canvas.open()
  })

  test("draws the Flow that was opened, with its Nodes and its Wires", async ({ page }) => {
    await expect(canvas.node("node-trigger")).toBeVisible()
    await expect(canvas.node("node-reply")).toBeVisible()
    await expect(canvas.wire("wire-execution")).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Your flows" })).toContainText("Hello")
  })

  test("keeps what the user types into a Node", async () => {
    const name = canvas.field("node-trigger", "name")

    await name.fill("goodbye")
    await canvas.field("node-reply", "content").fill("See you")

    await expect(name).toHaveValue("goodbye")
    await expect(canvas.field("node-reply", "content")).toHaveValue("See you")
  })

  test("moves a Node to where it was dragged", async () => {
    const node = canvas.node("node-reply")
    const before = await node.boundingBox()

    await canvas.dragNode("node-reply", { x: 0, y: 120 })

    const after = await node.boundingBox()
    expect(after?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 50)
  })

  test("connects a Data Wire and writes the Coercion on it", async () => {
    await canvas.drawWire(
      canvas.port("node-trigger", "user"),
      canvas.port("node-reply", "slot.slot-who")
    )

    await expect(canvas.wires()).toHaveCount(2)
    // `wire-2` is the second Wire the Flow has ever had: the Execution Wire it
    // was opened with, then this one.
    await expect(canvas.coercionOn("wire-2")).toHaveText("as text")
  })

  test("refuses a Wire between an Execution Port and a Data Port", async () => {
    await canvas.drawWire(
      canvas.port("node-trigger", "next"),
      canvas.port("node-reply", "slot.slot-who")
    )

    await expect(canvas.refusal()).toBeVisible()
    await expect(canvas.wires()).toHaveCount(1)
  })

  test("refuses a second Wire leaving an Execution output Port", async () => {
    await canvas.drawWire(canvas.port("node-trigger", "next"), canvas.port("node-reply", "in"))

    await expect(canvas.refusal()).toContainText("Only one thing can happen next")
    await expect(canvas.wires()).toHaveCount(1)
  })

  test("refuses a second Wire arriving at a Data input Port", async () => {
    await canvas.drawWire(
      canvas.port("node-trigger", "user"),
      canvas.port("node-reply", "slot.slot-who")
    )
    await expect(canvas.wires()).toHaveCount(2)

    await canvas.drawWire(
      canvas.port("node-trigger", "user"),
      canvas.port("node-reply", "slot.slot-who")
    )

    await expect(canvas.refusal()).toContainText("already reads a value")
    await expect(canvas.wires()).toHaveCount(2)
  })

  test("disconnects a Wire", async () => {
    await canvas.removeWire("wire-execution").click()

    await expect(canvas.wire("wire-execution")).toHaveCount(0)
    await expect(canvas.wires()).toHaveCount(0)
  })
})
