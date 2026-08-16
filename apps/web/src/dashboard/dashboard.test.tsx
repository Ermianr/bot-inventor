// @vitest-environment jsdom

import { greetingProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Dashboard } from "@/dashboard/dashboard"
import { translate } from "@/i18n/messages"
import { fakeProjectStore } from "@/project/fake-project-store"

/**
 * The Dashboard as the user meets it, with the store in memory.
 *
 * What the hook decides is covered where the hook is. What only this screen can
 * be held to is the wiring: that a card opens the Project it names, that the
 * dialog's fields reach the store, and that a Project that could not be listed
 * does not turn up as the reason a name was refused. Every one of those can be
 * got wrong without anything failing to type-check.
 */

afterEach(cleanup)

/** The screen, and every Project it was asked to open. */
function show(store = fakeProjectStore()) {
  const opened: string[] = []
  render(<Dashboard store={store} onOpen={projectId => opened.push(projectId)} />)
  return { store, opened }
}

/** Fills the creation dialog and presses the button that makes the Project. */
async function fillIn({ name, token }: { name: string; token: string }) {
  fireEvent.change(await screen.findByTestId("create-project-name"), { target: { value: name } })
  fireEvent.change(screen.getByTestId("create-project-token"), { target: { value: token } })
  await act(async () => {
    fireEvent.click(screen.getByTestId("create-project-confirm"))
  })
}

describe("the Dashboard", () => {
  it("shows a card for each Project the store holds", async () => {
    show(fakeProjectStore([helloProject(), greetingProject()]))

    await waitFor(() => {
      expect(screen.getAllByTestId("card-name")).toHaveLength(2)
    })
    expect(screen.getAllByTestId("card-name").map(card => card.textContent)).toEqual(
      expect.arrayContaining([helloProject().name, greetingProject().name])
    )
  })

  it("invites the user to build something when the store holds nothing", async () => {
    show()

    expect(await screen.findByTestId("dashboard-empty")).toBeDefined()
  })

  /**
   * An empty state shown while the list is still being read tells a user with
   * ten Projects that they have none, which is the one thing this screen must
   * never say.
   */
  it("says nothing at all until the store has answered", () => {
    show(fakeProjectStore([helloProject()]))

    expect(screen.queryByTestId("dashboard-empty")).toBeNull()
    expect(screen.queryAllByTestId("card-name")).toEqual([])
  })

  it("opens the Project whose card was clicked", async () => {
    const { opened } = show(fakeProjectStore([helloProject(), greetingProject()]))

    const card = await screen.findByTestId(`project-card-${greetingProject().id}`)
    fireEvent.click(card)

    expect(opened).toEqual([greetingProject().id])
  })

  it("names a Project the Dashboard could not read, rather than leaving the card blank", async () => {
    const store = fakeProjectStore()
    store.contents.set("project-damaged", { document: "half a fi", testServerId: "", secret: "" })
    show(store)

    const name = await screen.findByTestId("card-name")
    expect(name.textContent).toBe(translate("dashboard.card.unreadable"))
  })
})

describe("creating a Project from the Dashboard", () => {
  it("stores what the dialog asked for and lands the user in the editor", async () => {
    const { store, opened } = show()

    fireEvent.click(await screen.findByTestId("dashboard-create"))
    await fillIn({ name: "Moderation bot", token: "a-token" })

    const [created] = opened
    expect(created).toBeDefined()
    expect(store.contents.get(created ?? "")?.secret).toBe("a-token")
    expect(store.contents.get(created ?? "")?.document).toContain("Moderation bot")
  })

  it("keeps the dialog open and says why when the store would not take it", async () => {
    const { store, opened } = show()
    store.breaks.create = "the disk is full"

    fireEvent.click(await screen.findByTestId("dashboard-create"))
    await fillIn({ name: "Moderation bot", token: "a-token" })

    expect(opened).toEqual([])
    expect((await screen.findByTestId("create-project-problem")).textContent).toContain(
      "the disk is full"
    )
  })

  /**
   * The two failures are read in two different places. A disk that would not
   * answer must not turn up inside the dialog as the reason the name the user
   * just typed was refused.
   */
  it("keeps a listing failure off the creation dialog", async () => {
    const store = fakeProjectStore()
    store.breaks.list = "the disk is asleep"
    show(store)

    expect((await screen.findByTestId("dashboard-problem")).textContent).toContain(
      "the disk is asleep"
    )

    fireEvent.click(screen.getByTestId("dashboard-create"))
    await screen.findByTestId("create-project-dialog")

    expect(screen.queryByTestId("create-project-problem")).toBeNull()
  })

  it("makes the example a Project of the user's own and opens it", async () => {
    const { store, opened } = show()

    const example = await screen.findByTestId("dashboard-example")
    await act(async () => {
      fireEvent.click(example)
    })

    const [created] = opened
    expect(created).toBeDefined()
    expect(store.contents.get(created ?? "")?.document).toContain("flow-hello")
  })
})
