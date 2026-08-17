// @vitest-environment jsdom

import { helloProject } from "@bot-inventor/schema/fixtures"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { translate } from "@/i18n/messages"
import { type FakeProjectStore, fakeProjectStore } from "@/project/fake-project-store"
import { ProjectOptionsDialog } from "@/project/project-options-dialog"
import { useTestServer } from "@/project/use-test-server"

/**
 * Project Options, driven through the in-memory fake of the port.
 *
 * What is worth holding this dialog to is what it does with a Secret: that it
 * says one is there without putting it on screen, that a replacement reaches
 * the keychain, and that a keychain refusing one is read here rather than
 * nowhere. The Test Server goes the same way it goes at every other moment,
 * which is why the assertion is on the store and not on the field.
 */

afterEach(cleanup)

const project = helloProject()

/** The dialog, open, on a Project the store already holds. */
function show(store: FakeProjectStore) {
  render(<Options store={store} />)
  return store
}

function Options({ store }: { store: FakeProjectStore }) {
  const testServer = useTestServer(store, project.id)
  return (
    <ProjectOptionsDialog
      open
      onOpenChange={() => {}}
      store={store}
      projectId={project.id}
      testServer={testServer}
    />
  )
}

/** Types a token and presses the button that saves it. */
async function replaceToken(token: string) {
  fireEvent.change(await screen.findByTestId("project-options-token"), {
    target: { value: token }
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId("project-options-done"))
  })
}

describe("Project Options", () => {
  it("says a token is stored without ever showing it", async () => {
    const store = fakeProjectStore([project])
    await store.storeSecret(project.id, "the-stored-token")
    show(store)

    const note = await screen.findByTestId("project-options-token-state")
    expect(note.textContent).toBe(translate("project.token.present"))

    const field = screen.getByTestId<HTMLInputElement>("project-options-token")
    expect(field.value).toBe("")
    expect(document.body.textContent).not.toContain("the-stored-token")
  })

  it("says when there is no token yet", async () => {
    show(fakeProjectStore([project]))

    const note = await screen.findByTestId("project-options-token-state")
    expect(note.textContent).toBe(translate("project.token.absent"))
  })

  /**
   * "No token" is a sentence about somebody's Project, not about the keychain
   * that would not answer. Saying it when nothing was asked tells a user whose
   * token is perfectly safe that it is gone.
   */
  it("says nothing about a token when the keychain would not answer", async () => {
    const store = fakeProjectStore([project])
    store.breaks.hasSecret = "the keychain is locked"
    show(store)

    expect((await screen.findByTestId("project-options-problem")).textContent).toContain(
      "the keychain is locked"
    )
    expect(screen.queryByTestId("project-options-token-state")).toBeNull()
  })

  it("replaces the token the Project runs with", async () => {
    const store = show(fakeProjectStore([project]))

    await replaceToken("a-new-token")

    expect(store.contents.get(project.id)?.secret).toBe("a-new-token")
    expect((await screen.findByTestId("project-options-token-state")).textContent).toBe(
      translate("project.token.present")
    )
  })

  /** A keychain that will not take a token has to say so where it was typed. */
  it("explains a keychain that refuses the token", async () => {
    const store = fakeProjectStore([project])
    store.breaks.storeSecret = "the keychain is locked"
    show(store)

    await replaceToken("a-new-token")

    expect((await screen.findByTestId("project-options-problem")).textContent).toContain(
      "the keychain is locked"
    )
    expect(store.contents.get(project.id)?.secret).toBe("")
  })

  it("leaves the stored token alone when nothing was typed", async () => {
    const store = fakeProjectStore([project])
    await store.storeSecret(project.id, "the-stored-token")
    show(store)

    const save = await screen.findByTestId("project-options-done")
    await act(async () => {
      fireEvent.click(save)
    })

    expect(store.contents.get(project.id)?.secret).toBe("the-stored-token")
  })

  it("changes the Test Server the Project is tried on", async () => {
    const store = show(fakeProjectStore([project]))

    const field = await screen.findByTestId("project-options-test-server")
    await act(async () => {
      fireEvent.change(field, { target: { value: "123456789" } })
    })

    await waitFor(() => {
      expect(store.contents.get(project.id)?.testServerId).toBe("123456789")
    })
  })
})
