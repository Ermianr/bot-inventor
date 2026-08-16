import { expect, type Locator, test } from "@playwright/test"
import { FlowListPage } from "./pages/flow-list-page"

/**
 * What the controls on a Flow row say and how they look while the pointer is on
 * them.
 *
 * The words themselves are not asserted, because they are translated and the
 * test would otherwise only pass in English. What is asserted is that the
 * tooltip says the same thing the control already answers to: those two cannot
 * drift apart, and comparing them holds whichever language the editor is in.
 */
test.describe("the controls on a Flow row", () => {
  let flows: FlowListPage

  test.beforeEach(async ({ page }) => {
    flows = new FlowListPage(page)
    await flows.open()
  })

  /**
   * Rests the pointer on a control and reads back what the editor explains,
   * next to what the control is called. The two are returned together so the
   * assertion is the comparison rather than a sentence written twice.
   */
  async function explanationOf(control: Locator): Promise<{ tooltip: string; name: string }> {
    await control.hover()
    await expect(flows.tooltip()).toBeVisible()

    return {
      tooltip: ((await flows.tooltip().textContent()) ?? "").trim(),
      name: (await control.getAttribute("aria-label")) ?? ""
    }
  }

  /** What a control is painted while the pointer rests on it. */
  async function hoveredBackground(control: Locator): Promise<string> {
    await control.hover()
    return control.evaluate(element => getComputedStyle(element).backgroundColor)
  }

  test("explains the pencil in the editor's own words", async () => {
    const { tooltip, name } = await explanationOf(flows.editName("flow-hello"))

    expect(tooltip).toBe(name)
    expect(name).not.toBe("")
  })

  test("explains the bin in the editor's own words", async () => {
    const { tooltip, name } = await explanationOf(flows.remove("flow-hello"))

    expect(tooltip).toBe(name)
    expect(name).not.toBe("")
  })

  test("explains the mark on a Flow that never runs", async () => {
    await flows.create().click()
    await flows.openField().press("Enter")

    const { tooltip, name } = await explanationOf(flows.neverRunsOpen())

    expect(tooltip).toBe(name)
    expect(name).not.toBe("")
  })

  test("leaves the operating system's own explanation off the controls", async () => {
    await flows.create().click()
    await flows.openField().press("Enter")

    for (const control of [flows.editName("flow-hello"), flows.remove("flow-hello")]) {
      await expect(control).not.toHaveAttribute("title")
    }
    await expect(flows.neverRunsOpen()).not.toHaveAttribute("title")
  })

  test("shows the hover of a control on the Flow that is open", async () => {
    const row = flows.row("flow-hello")
    const background = await row.evaluate(element => getComputedStyle(element).backgroundColor)

    expect(await hoveredBackground(flows.editName("flow-hello"))).not.toBe(background)
    expect(await hoveredBackground(flows.remove("flow-hello"))).not.toBe(background)
  })

  test("shows the hover of a control on a Flow that is not open", async () => {
    const row = flows.row("flow-goodbye")
    // The row colours itself under the pointer too, and that is the colour a
    // control on it has to stand out from.
    await row.hover()
    const background = await row.evaluate(element => getComputedStyle(element).backgroundColor)

    expect(await hoveredBackground(flows.editName("flow-goodbye"))).not.toBe(background)
    expect(await hoveredBackground(flows.remove("flow-goodbye"))).not.toBe(background)
  })
})
