import { expect, test } from "@playwright/test"
import { FlowListPage } from "./pages/flow-list-page"

/**
 * Naming a Flow from the Flow list, as the user does it: pencil, type, Enter —
 * and what happens when the name is one another Flow already has.
 */
test.describe("a Flow name", () => {
  let flows: FlowListPage

  test.beforeEach(async ({ page }) => {
    flows = new FlowListPage(page)
    await flows.open()
  })

  test("takes the name the user types and shows it in the list", async () => {
    await flows.editName("flow-hello").click()
    await flows.nameField("flow-hello").fill("Welcome")
    await flows.nameField("flow-hello").press("Enter")

    await expect(flows.name("flow-hello")).toHaveText("Welcome")
    await expect(flows.name("flow-goodbye")).toHaveText("Goodbye")
  })

  test("leaves the previous name when the rename is cancelled", async () => {
    await flows.editName("flow-hello").click()
    await flows.nameField("flow-hello").fill("Welcome")
    await flows.nameField("flow-hello").press("Escape")

    await expect(flows.name("flow-hello")).toHaveText("Hello")
  })

  test("refuses a name another Flow has, saying so and keeping the field open", async () => {
    await flows.editName("flow-hello").click()
    await flows.nameField("flow-hello").fill("Goodbye")
    await flows.nameField("flow-hello").press("Enter")

    await expect(flows.toast()).toBeVisible()
    await expect(flows.nameField("flow-hello")).toBeVisible()
    await expect(flows.nameField("flow-hello")).toHaveValue("Goodbye")
    // Nothing moved: the other Flow is still the only one called Goodbye.
    await expect(flows.name("flow-goodbye")).toHaveText("Goodbye")
  })

  test("refuses a blank name and keeps the user in the field", async () => {
    await flows.editName("flow-hello").click()
    await flows.nameField("flow-hello").fill("   ")
    await flows.nameField("flow-hello").press("Enter")

    await expect(flows.nameField("flow-hello")).toBeVisible()
  })

  test("opens the Flow whose name was clicked", async () => {
    await flows.name("flow-goodbye").click()

    await expect(flows.editName("flow-goodbye")).toBeVisible()
    await expect(flows.name("flow-goodbye").locator("xpath=ancestor::li")).toHaveAttribute(
      "aria-current",
      "true"
    )
  })
})
