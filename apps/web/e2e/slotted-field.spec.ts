import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"

/**
 * Putting a value inside a sentence: the gesture the whole Slot feature is
 * about.
 *
 * The demonstration Project's reply already reads "Hello, " followed by a Slot
 * nothing is wired to, so there is a pill on screen from the start and a text
 * box on either side of it.
 */
test.describe("a text field with values inside it", () => {
  let canvas: CanvasPage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    await canvas.open()
  })

  test("draws a Slot the Project already holds as a pill inside the text", async () => {
    await expect(canvas.slot("node-reply", "content", 0)).toBeVisible()
    await expect(canvas.field("node-reply", "content")).toHaveValue("Hello, ")
  })

  test("drops a Wire on the text and gets a pill named after where the value comes from", async () => {
    await canvas.dropWireOnField(
      canvas.port("node-trigger", "user"),
      canvas.fieldBox("node-reply", "content", 1)
    )

    await expect(canvas.slots("node-reply", "content")).toHaveCount(2)
    await expect(canvas.slot("node-reply", "content", 1)).toContainText("Slash command")
    await expect(canvas.slot("node-reply", "content", 1)).toContainText("Who used it")
    // The Execution Wire the Flow was opened with, and the one just drawn.
    await expect(canvas.wires()).toHaveCount(2)
    await expect(canvas.coercionOn("wire-2")).toHaveText("as text")
  })

  test("types freely before a pill, after it, and between two of them", async () => {
    await canvas.dropWireOnField(
      canvas.port("node-trigger", "user"),
      canvas.fieldBox("node-reply", "content", 1)
    )

    await canvas.fieldBox("node-reply", "content", 0).fill("Hi ")
    await canvas.fieldBox("node-reply", "content", 1).fill(" and ")
    await canvas.fieldBox("node-reply", "content", 2).fill("!")

    await expect(canvas.fieldBox("node-reply", "content", 0)).toHaveValue("Hi ")
    await expect(canvas.fieldBox("node-reply", "content", 1)).toHaveValue(" and ")
    await expect(canvas.fieldBox("node-reply", "content", 2)).toHaveValue("!")
    await expect(canvas.slots("node-reply", "content")).toHaveCount(2)
  })

  test("crosses a pill with the arrow keys, as often as the user does", async ({ page }) => {
    const before = canvas.fieldBox("node-reply", "content", 0)
    const after = canvas.fieldBox("node-reply", "content", 1)

    // Four times over, because once is not the question. Crossing is remembered
    // as where the caret is to go next, and a field that only forwards the
    // first crossing looks right until the user comes back.
    for (let crossing = 0; crossing < 4; crossing++) {
      await before.click()
      await page.keyboard.press("End")
      await page.keyboard.press("ArrowRight")

      await expect(after).toBeFocused()
      expect(await canvas.caretIn("node-reply", "content", 1)).toBe(0)

      await page.keyboard.press("ArrowLeft")

      await expect(before).toBeFocused()
      expect(await canvas.caretIn("node-reply", "content", 0)).toBe("Hello, ".length)
    }
  })

  test("takes a pill nothing is wired to without asking", async () => {
    await canvas.removeSlot("node-reply", "content", 0).click()

    await expect(canvas.slotRemovalQuestion()).toHaveCount(0)
    await expect(canvas.slots("node-reply", "content")).toHaveCount(0)
    await expect(canvas.field("node-reply", "content")).toHaveValue("Hello, ")
  })

  test("says a Wire will go with the pill, and takes both when told to", async () => {
    await canvas.dropWireOnField(
      canvas.port("node-trigger", "user"),
      canvas.fieldBox("node-reply", "content", 1)
    )
    await expect(canvas.wires()).toHaveCount(2)

    await canvas.removeSlot("node-reply", "content", 1).click()
    await expect(canvas.slotRemovalQuestion()).toBeVisible()
    await canvas.confirmSlotRemoval().click()

    await expect(canvas.slots("node-reply", "content")).toHaveCount(1)
    await expect(canvas.wire("wire-2")).toHaveCount(0)
    await expect(canvas.wires()).toHaveCount(1)
  })

  test("keeps the pill and its Wire when the user changes their mind", async () => {
    await canvas.dropWireOnField(
      canvas.port("node-trigger", "user"),
      canvas.fieldBox("node-reply", "content", 1)
    )

    await canvas.removeSlot("node-reply", "content", 1).click()
    await canvas.cancelSlotRemoval().click()

    await expect(canvas.slots("node-reply", "content")).toHaveCount(2)
    await expect(canvas.wires()).toHaveCount(2)
  })

  test("refuses a Wire that carries no value at all, and says why", async () => {
    await canvas.dropWireOnField(
      canvas.port("node-trigger", "next"),
      canvas.fieldBox("node-reply", "content", 1)
    )

    await expect(canvas.refusal()).toBeVisible()
    await expect(canvas.slots("node-reply", "content")).toHaveCount(1)
    await expect(canvas.wires()).toHaveCount(1)
  })
})
