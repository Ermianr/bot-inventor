import { expect, test } from "@playwright/test"
import { FlowListPage } from "./pages/flow-list-page"

/**
 * Adding a Flow, as the user does it: press "+", type over the default name it
 * was given, and be on its empty Canvas.
 *
 * The new Flow is found by whichever name is a field rather than by its id: the
 * id is a fresh UUID, which is the point, and nothing the test can predict.
 */
test.describe("creating a Flow", () => {
  let flows: FlowListPage

  test.beforeEach(async ({ page }) => {
    flows = new FlowListPage(page)
    await flows.open()
  })

  test("opens the new Flow on an empty Canvas, ready to be named", async ({ page }) => {
    await flows.create().click()

    await expect(flows.openField()).toBeFocused()
    // The default name is translated, so what it says is not something this
    // test can spell; that it was given one, and that the user is in front of
    // it, is what creating a Flow promises.
    await expect(flows.openField()).not.toHaveValue("")
    // The Flow it opened is its own: nothing the demonstration Project drew is
    // on the Canvas.
    await expect(page.locator('[data-testid^="node-"]')).toHaveCount(0)
    await expect(flows.names()).toHaveCount(2)
  })

  test("keeps the name the user types over the default", async () => {
    await flows.create().click()
    await flows.openField().fill("Support")
    await flows.openField().press("Enter")

    await expect(flows.names()).toHaveCount(3)
    await expect(flows.names().last()).toHaveText("Support")
  })

  test("numbers the default name so a second Flow never collides", async () => {
    await flows.create().click()
    // Read rather than written: the number is what this test is about, and the
    // word it is added to is whichever language the editor is in.
    const first = await flows.openField().inputValue()
    await flows.openField().press("Enter")

    await flows.create().click()
    await expect(flows.openField()).toHaveValue(`${first} 2`)
  })

  test("puts the Flow it created on the Canvas", async ({ page }) => {
    await flows.create().click()
    await flows.openField().press("Enter")

    await expect(flows.names().last().locator("xpath=ancestor::li")).toHaveAttribute(
      "aria-current",
      "true"
    )
    await expect(page.locator('[data-testid^="node-"]')).toHaveCount(0)
  })
})
