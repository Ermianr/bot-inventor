import { expect, test } from "@playwright/test"
import { FlowListPage } from "./pages/flow-list-page"

/**
 * Removing a Flow, as the user does it: press the bin, answer the question, and
 * land on the Flow beside the one that went.
 *
 * The demonstration Project opens on "Hello" with "Goodbye" under it, which is
 * both neighbours the rule can choose between.
 */
test.describe("removing a Flow", () => {
  let flows: FlowListPage

  test.beforeEach(async ({ page }) => {
    flows = new FlowListPage(page)
    await flows.open()
  })

  /** Asserts the Canvas is showing this Flow. */
  async function expectOpen(flowId: string) {
    await expect(flows.name(flowId).locator("xpath=ancestor::li")).toHaveAttribute(
      "aria-current",
      "true"
    )
  }

  test("opens the Flow before the one it removed", async () => {
    await flows.name("flow-goodbye").click()

    await flows.removeOpen().click()
    await expect(flows.removeDialog()).toBeVisible()
    await flows.confirmRemoval().click()

    await expect(flows.names()).toHaveCount(1)
    await expectOpen("flow-hello")
  })

  test("opens the Flow after the one it removed when that was the first", async () => {
    await flows.removeOpen().click()
    await flows.confirmRemoval().click()

    await expect(flows.names()).toHaveCount(1)
    await expectOpen("flow-goodbye")
  })

  test("changes nothing when the question is answered no", async () => {
    await flows.removeOpen().click()
    await flows.cancelRemoval().click()

    await expect(flows.removeDialog()).toBeHidden()
    await expect(flows.names()).toHaveCount(2)
    await expect(flows.name("flow-hello")).toBeVisible()
  })

  test("leaves the open Flow where it was when another Flow goes", async ({ page }) => {
    // The bin of a Flow that is not open only appears once the row is reached,
    // the same as its pencil.
    await flows.name("flow-goodbye").hover()
    await flows.remove("flow-goodbye").click()
    await flows.confirmRemoval().click()

    await expect(flows.names()).toHaveCount(1)
    await expect(flows.name("flow-hello")).toBeVisible()
    // Still the Canvas the user was working on: the demonstration Flow's Nodes
    // are where they were.
    await expect(page.locator('[data-testid^="node-"]').first()).toBeVisible()
  })

  test("refuses to remove the only Flow of the Project", async () => {
    await flows.removeOpen().click()
    await flows.confirmRemoval().click()
    await expect(flows.names()).toHaveCount(1)

    await flows.removeOpen().click()

    await expect(flows.removeDialog()).toBeHidden()
    await expect(flows.toast()).toBeVisible()
    await expect(flows.names()).toHaveCount(1)
  })
})
