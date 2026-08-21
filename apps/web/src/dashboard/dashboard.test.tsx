// @vitest-environment jsdom

import { greetingProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Dashboard } from "@/dashboard/dashboard"
import { translate } from "@/i18n/messages"
import { fakeImportGateway } from "@/project/fake-import-gateway"
import { fakeProjectStore } from "@/project/fake-project-store"
import { serializeProject } from "@/project/project-store"
import { settled } from "../../testing/settled"

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
function show(store = fakeProjectStore(), imports = fakeImportGateway()) {
  const opened: string[] = []
  render(<Dashboard store={store} imports={imports} onOpen={projectId => opened.push(projectId)} />)
  return { store, imports, opened }
}

/** Fills the creation dialog and presses the button that makes the Project. */
async function fillIn({ name, token }: { name: string; token: string }) {
  fireEvent.change(await screen.findByTestId("create-project-name"), { target: { value: name } })
  fireEvent.change(screen.getByTestId("create-project-token"), { target: { value: token } })
  await act(async () => {
    fireEvent.click(screen.getByTestId("create-project-confirm"))
  })
}

/** What is written in the creation dialog's name field. */
async function nameField() {
  return ((await screen.findByTestId("create-project-name")) as HTMLInputElement).value
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
  it("says nothing at all until the store has answered", async () => {
    show(fakeProjectStore([helloProject()]))

    expect(screen.queryByTestId("dashboard-empty")).toBeNull()
    expect(screen.queryAllByTestId("card-name")).toEqual([])

    // The store answers after the two assertions above, which is the whole
    // point of them — but it answers, and the render it causes belongs to this
    // test rather than to whichever one is running by the time it lands.
    await settled()
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

describe("managing a Project from its card", () => {
  /** Opens the menu in the corner of a card and picks one of the three things. */
  async function pick(projectId: string, what: "rename" | "duplicate" | "delete") {
    const menu = await screen.findByTestId(`card-manage-${projectId}`)
    // The card arrives with the list, so this menu is a control that has only
    // just appeared: it is not attached to the Menu behind it until React runs
    // the render it has scheduled, and a click before that is dropped.
    await settled()
    await act(async () => {
      fireEvent.click(menu)
    })

    const item = await screen.findByTestId(`card-${what}-${projectId}`)
    await act(async () => {
      fireEvent.click(item)
    })
  }

  it("renames the Project the dialog was opened from", async () => {
    const { store } = show(fakeProjectStore([helloProject()]))

    await pick(helloProject().id, "rename")
    fireEvent.change(await screen.findByTestId("rename-project-name"), {
      target: { value: "Welcome bot" }
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("rename-project-confirm"))
    })

    expect(store.contents.get(helloProject().id)?.document).toContain("Welcome bot")
    await waitFor(() => {
      expect(screen.queryByTestId("rename-project-dialog")).toBeNull()
    })
  })

  it("keeps the rename dialog open and says why when the store would not take it", async () => {
    const { store } = show(fakeProjectStore([helloProject()]))
    store.breaks.write = "the disk is full"

    await pick(helloProject().id, "rename")
    fireEvent.change(await screen.findByTestId("rename-project-name"), {
      target: { value: "Welcome bot" }
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("rename-project-confirm"))
    })

    expect((await screen.findByTestId("rename-project-problem")).textContent).toContain(
      "the disk is full"
    )
  })

  it("copies the Project without a dialog, and lists the copy beside it", async () => {
    show(fakeProjectStore([helloProject()]))

    await pick(helloProject().id, "duplicate")

    await waitFor(() => {
      expect(screen.getAllByTestId("card-name")).toHaveLength(2)
    })
  })

  /** Duplicating has no dialog, so its card is the only place to say this. */
  it("explains a copy that could not be made on the card it was asked of", async () => {
    const { store } = show(fakeProjectStore([helloProject()]))
    store.breaks.create = "the disk is full"

    await pick(helloProject().id, "duplicate")

    expect((await screen.findByTestId(`card-problem-${helloProject().id}`)).textContent).toContain(
      "the disk is full"
    )
  })

  it("asks before deleting, and removes nothing while the question stands", async () => {
    const { store } = show(fakeProjectStore([helloProject()]))

    await pick(helloProject().id, "delete")

    expect(await screen.findByTestId("delete-project-dialog")).toBeDefined()
    expect(store.contents.has(helloProject().id)).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-project-cancel"))
    })
    expect(store.contents.has(helloProject().id)).toBe(true)
  })

  it("deletes the Project once the question is answered", async () => {
    const { store } = show(fakeProjectStore([helloProject()]))

    await pick(helloProject().id, "delete")
    // Found before the scope rather than inside it: `findBy…` turns the act
    // environment off while it waits, and React then says the `act` around it
    // is not one.
    const confirm = await screen.findByTestId("delete-project-confirm")
    await act(async () => {
      fireEvent.click(confirm)
    })

    expect(store.contents.has(helloProject().id)).toBe(false)
    expect(await screen.findByTestId("dashboard-empty")).toBeDefined()
  })

  it("keeps the question open and says why when the Project could not be deleted", async () => {
    const { store } = show(fakeProjectStore([helloProject()]))
    store.breaks.remove = "the folder is in use"

    await pick(helloProject().id, "delete")
    const confirm = await screen.findByTestId("delete-project-confirm")
    await act(async () => {
      fireEvent.click(confirm)
    })

    expect((await screen.findByTestId("delete-project-problem")).textContent).toContain(
      "the folder is in use"
    )
    expect(store.contents.has(helloProject().id)).toBe(true)
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

    fireEvent.click(await screen.findByTestId("dashboard-example"))
    await fillIn({ name: "Example bot", token: "a-token" })

    const [created] = opened
    expect(created).toBeDefined()
    expect(store.contents.get(created ?? "")?.document).toContain("flow-hello")
    expect(store.contents.get(created ?? "")?.secret).toBe("a-token")
  })

  /**
   * The example is asked for with the same three questions as anything else,
   * and the button that would make it stays dead until the token is one of the
   * answers.
   */
  it("asks for a token before it will make the example", async () => {
    const { opened } = show()

    fireEvent.click(await screen.findByTestId("dashboard-example"))

    const confirm = await screen.findByTestId("create-project-confirm")
    expect(confirm.hasAttribute("disabled")).toBe(true)
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(opened).toEqual([])
  })

  /**
   * A reason belongs to the attempt it was about. Opening the dialog again is
   * not that attempt, and the user has not yet asked for anything to refuse.
   */
  it("does not carry a refusal into the next dialog the user opens", async () => {
    const { store } = show()
    store.breaks.create = "the disk is full"

    fireEvent.click(await screen.findByTestId("dashboard-create"))
    await fillIn({ name: "Moderation bot", token: "a-token" })
    expect(await screen.findByTestId("create-project-problem")).toBeDefined()

    fireEvent.click(screen.getByTestId("create-project-cancel"))
    fireEvent.click(screen.getByTestId("dashboard-example"))

    await screen.findByTestId("create-project-name")
    expect(screen.queryByTestId("create-project-problem")).toBeNull()
  })

  /** Two buttons, one dialog: the fields must not carry over between them. */
  it("does not leave the example's name in the dialog the other button opens", async () => {
    show()

    fireEvent.click(await screen.findByTestId("dashboard-example"))
    expect(await nameField()).toBe(translate("dashboard.example.name"))

    fireEvent.click(screen.getByTestId("create-project-cancel"))
    fireEvent.click(screen.getByTestId("dashboard-create"))

    expect(await nameField()).toBe("")
  })
})

describe("taking in a Project somebody sent", () => {
  /** A Project File on the user's disk, as the open dialog would hand it over. */
  const sent = (project = helloProject()) =>
    fakeImportGateway({ path: "C:/sent/their-bot.botinv", contents: serializeProject(project) })

  it("asks the same questions creating asks, then makes the Project and opens it", async () => {
    const { store, opened } = show(fakeProjectStore(), sent())

    fireEvent.click(await screen.findByTestId("dashboard-import"))
    await fillIn({ name: "Their bot", token: "a-token" })

    const [created] = opened
    expect(created).toBeDefined()
    // The id in the file is not where it landed, and the file's Project is.
    expect(created).not.toBe(helloProject().id)
    expect(store.contents.get(created ?? "")?.secret).toBe("a-token")
    expect(store.contents.get(created ?? "")?.document).toContain("flow-hello")
  })

  it("offers the name the Project arrived under", async () => {
    show(fakeProjectStore(), sent())

    fireEvent.click(await screen.findByTestId("dashboard-import"))

    expect(await nameField()).toBe(helloProject().name)
  })

  it("says why a file it could not read was refused, and makes nothing", async () => {
    const { store } = show(
      fakeProjectStore(),
      fakeImportGateway({ path: "C:/sent/broken.botinv", contents: "half a file" })
    )

    fireEvent.click(await screen.findByTestId("dashboard-import"))

    expect((await screen.findByTestId("dashboard-import-problem")).textContent).toContain(
      translate("project.problem.malformed")
    )
    expect(screen.queryByTestId("create-project-dialog")).toBeNull()
    expect(store.contents.size).toBe(0)
  })

  it("does nothing and says nothing when the user closes the open dialog", async () => {
    const { store } = show(fakeProjectStore(), fakeImportGateway({ path: undefined }))

    fireEvent.click(await screen.findByTestId("dashboard-import"))

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-import")).toBeDefined()
    })
    expect(screen.queryByTestId("create-project-dialog")).toBeNull()
    expect(screen.queryByTestId("dashboard-import-problem")).toBeNull()
    expect(store.contents.size).toBe(0)
  })

  /** Cancelling the questions leaves the Dashboard exactly as it was. */
  it("makes nothing when the user cancels the dialog it opens", async () => {
    const { store, opened } = show(fakeProjectStore(), sent())

    fireEvent.click(await screen.findByTestId("dashboard-import"))
    await screen.findByTestId("create-project-dialog")
    fireEvent.click(screen.getByTestId("create-project-cancel"))

    expect(opened).toEqual([])
    expect(store.contents.size).toBe(0)
  })

  /**
   * The same file twice is two Projects, and the second one never lands on the
   * first: an import copies, it does not overwrite.
   */
  it("makes a second Project out of the same file, leaving the first alone", async () => {
    const { store } = show(fakeProjectStore(), sent())

    fireEvent.click(await screen.findByTestId("dashboard-import"))
    await fillIn({ name: "Their bot", token: "a-token" })

    fireEvent.click(await screen.findByTestId("dashboard-import"))
    await fillIn({ name: "Their bot again", token: "another-token" })

    expect(store.contents.size).toBe(2)
    const documents = [...store.contents.values()].map(held => held.document)
    expect(documents.filter(document => document.includes("Their bot again"))).toHaveLength(1)
    expect(documents.filter(document => document.includes('"name": "Their bot"'))).toHaveLength(1)
  })
})

/**
 * A dialog reopened is a dialog nobody has filled in. What the last one was
 * left holding is a bot token, and prefilling the next Project with it is the
 * accident that gives two Projects one Discord account.
 */
describe("the creation dialog, reopened", () => {
  const sentAgain = () =>
    fakeImportGateway({
      path: "C:/sent/their-bot.botinv",
      contents: serializeProject(helloProject())
    })

  /** What the token field is holding. */
  async function tokenField() {
    return ((await screen.findByTestId("create-project-token")) as HTMLInputElement).value
  }

  it("does not carry a token from one import into the next", async () => {
    show(fakeProjectStore(), sentAgain())

    fireEvent.click(await screen.findByTestId("dashboard-import"))
    await fillIn({ name: "Their bot", token: "a-token" })

    fireEvent.click(await screen.findByTestId("dashboard-import"))

    expect(await tokenField()).toBe("")
  })

  it("does not carry a token from one new bot into the next", async () => {
    show()

    fireEvent.click(await screen.findByTestId("dashboard-create"))
    await fillIn({ name: "Moderation bot", token: "a-token" })

    fireEvent.click(await screen.findByTestId("dashboard-create"))

    expect(await tokenField()).toBe("")
    expect(await nameField()).toBe("")
  })
})
