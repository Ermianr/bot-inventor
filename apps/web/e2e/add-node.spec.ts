import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"

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

    await page.keyboard.type("Repl")
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
    // The menu belongs to empty Canvas. A right-click on a Node is that Node's
    // own question, and it is answered by the Node's own menu.
    await canvas.rightClickNode("node-trigger")

    await expect(canvas.addNode()).toHaveCount(0)
  })

  test("lists a Trigger but does not let a Flow that has one take another", async () => {
    // The demonstration Flow starts at a slash command, so its Trigger is taken.
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()

    const trigger = canvas.nodeChoice("discord.trigger.slashCommand")
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute("data-disabled", "true")
    await expect(trigger).toContainText("This flow already has something that starts it.")

    // Nothing that is not a Trigger is affected by the rule.
    await expect(canvas.nodeChoice("discord.interaction.reply")).not.toHaveAttribute(
      "data-disabled",
      "true"
    )
  })

  test("tells the Nodes that start a Flow from the rest", async () => {
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()

    await expect(canvas.nodeGroup("triggers")).toContainText("Starts a flow")
    await expect(canvas.nodeGroup("triggers")).toContainText("Slash command")
    await expect(canvas.nodeGroup("rest")).toContainText("Everything else")
    await expect(canvas.nodeGroup("rest")).toContainText("Reply")
  })

  test("searches across both groups and drops a heading with nothing under it", async () => {
    await canvas.rightClickPane(empty)
    await canvas.addNode().click()
    const search = canvas.nodeList().getByRole("combobox")

    await search.fill("Slash")
    await expect(canvas.nodeGroup("triggers")).toBeVisible()
    await expect(canvas.nodeGroup("rest")).toBeHidden()

    await search.fill("Repl")
    await expect(canvas.nodeGroup("rest")).toBeVisible()
    await expect(canvas.nodeGroup("triggers")).toBeHidden()
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
