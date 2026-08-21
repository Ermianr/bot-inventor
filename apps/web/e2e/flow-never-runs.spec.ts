import { expect, test } from "@playwright/test"

import { FlowListPage } from "./pages/flow-list-page"

/**
 * The mark on a Flow that never runs, as the user meets it: a Flow is born
 * empty, so pressing "+" is the shortest way to a Flow with nothing to start
 * it.
 *
 * That the mark goes when a Trigger arrives is left to the unit tests: the
 * editor has no way yet to put a Node on a Canvas, so a test cannot give a Flow
 * a Trigger by hand.
 */
test.describe("a Flow that never runs", () => {
  let flows: FlowListPage

  test.beforeEach(async ({ page }) => {
    flows = new FlowListPage(page)
    await flows.open()
  })

  test("marks a Flow that was just created", async () => {
    await flows.create().click()
    await flows.openField().press("Enter")

    await expect(flows.neverRunsOpen()).toBeVisible()
  })

  test("leaves a Flow with a Trigger unmarked", async () => {
    await expect(flows.neverRuns("flow-hello")).toHaveCount(0)
  })
})
