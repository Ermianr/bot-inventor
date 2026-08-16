// @vitest-environment jsdom

import type { Project } from "@bot-inventor/schema"
import { futureVersionProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { fakeProjectStore } from "@/project/fake-project-store"
import { serializeProject } from "@/project/project-store"
import { useProject } from "@/project/use-project"
import { useAutosave, useStoredProject } from "@/project/use-stored-project"

/**
 * Opening a Project and keeping it. What is asserted throughout is what the
 * user would see — the Project on the Canvas, and the work still being there —
 * rather than anything about where it went.
 */

/** The editor as the route wires it: a Project, and autosave watching it. */
function editorWith(store = fakeProjectStore([helloProject()]), initial: Project = helloProject()) {
  const rendered = renderHook(() => {
    const editor = useProject(() => initial)
    return { editor, autosave: useAutosave(store, editor.project) }
  })
  return { store, ...rendered }
}

describe("opening a Project", () => {
  it("puts what the store holds on the Canvas", async () => {
    const store = fakeProjectStore([helloProject()])
    const { result } = renderHook(() => useStoredProject(store, helloProject().id))

    await waitFor(() => {
      expect(result.current.status).toBe("loaded")
    })
    expect(result.current).toMatchObject({ project: helloProject(), migrated: false })
  })

  it("explains a Project from a newer build rather than showing a blank screen", async () => {
    const store = fakeProjectStore()
    store.contents.set("project-future", {
      document: JSON.stringify(futureVersionProject()),
      testServerId: "",
      secret: ""
    })

    const { result } = renderHook(() => useStoredProject(store, "project-future"))

    await waitFor(() => {
      expect(result.current.status).toBe("problem")
    })
    expect(result.current).toMatchObject({ message: expect.stringContaining("newer version") })
  })

  it("explains a document that is not a Project at all", async () => {
    const store = fakeProjectStore()
    store.contents.set("project-damaged", { document: "half a fi", testServerId: "", secret: "" })

    const { result } = renderHook(() => useStoredProject(store, "project-damaged"))

    await waitFor(() => {
      expect(result.current.status).toBe("problem")
    })
  })

  it("explains a Project the store would not give up", async () => {
    const store = fakeProjectStore([helloProject()])
    store.breaks.read = "the disk is asleep"

    const { result } = renderHook(() => useStoredProject(store, helloProject().id))

    await waitFor(() => {
      expect(result.current.status).toBe("problem")
    })
    expect(result.current).toMatchObject({ message: expect.stringContaining("the disk is asleep") })
  })
})

describe("work that saves itself", () => {
  it("puts an edit in the store without anybody asking for it", async () => {
    const { store, result } = editorWith()

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))

    await waitFor(() => {
      expect(store.contents.get(helloProject().id)?.document).toContain("goodbye")
    })
    // And the editor knows it landed, which is what nothing else can tell the
    // user now that there is no Save to press.
    await waitFor(() => {
      expect(result.current.autosave.saved).toBe(true)
    })
  })

  it("carries a Flow the user created through to what is in the store", async () => {
    const { store, result } = editorWith()

    let created = ""
    act(() => {
      created = result.current.editor.createFlow()
    })

    await waitFor(() => {
      expect(store.contents.get(helloProject().id)?.document).toContain(created)
    })
  })

  it("does not bring back a Flow the user removed", async () => {
    const { store, result } = editorWith()

    let created = ""
    act(() => {
      created = result.current.editor.createFlow()
    })
    await waitFor(() => {
      expect(store.contents.get(helloProject().id)?.document).toContain(created)
    })

    act(() => {
      result.current.editor.removeFlow(created)
    })

    await waitFor(() => {
      expect(store.contents.get(helloProject().id)?.document).not.toContain(created)
    })
  })

  /**
   * Opening a Project must not write it back. A write nobody asked for moves
   * every Project to the top of the Dashboard the moment it is looked at.
   */
  it("writes nothing while nothing has been edited", async () => {
    const store = fakeProjectStore([helloProject()])
    const before = store.contents.get(helloProject().id)?.document

    const { result } = editorWith(store)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(result.current.autosave.saved).toBe(true)
    expect(store.contents.get(helloProject().id)?.document).toBe(before)
  })

  /**
   * Autosave took Save away, and the one thing it owes the user in exchange is
   * the truth about whether their work is safe.
   */
  it("says so when the write did not happen", async () => {
    const { store, result } = editorWith()
    store.breaks.write = "the disk is full"

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))

    await waitFor(() => {
      expect(result.current.autosave.problem).toContain("the disk is full")
    })
    expect(result.current.autosave.saved).toBe(false)
  })

  it("keeps trying after a failed write, and says nothing once one lands", async () => {
    const { store, result } = editorWith()
    store.breaks.write = "the disk is full"

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))
    await waitFor(() => {
      expect(result.current.autosave.problem).toBeDefined()
    })

    // The next edit is the next go: the store is working again, and what the
    // user typed while it was not is still on the Canvas to be written.
    act(() => result.current.editor.setNodeField("node-trigger", "name", "farewell"))

    await waitFor(() => {
      expect(result.current.autosave.problem).toBeUndefined()
    })
    expect(store.contents.get(helloProject().id)?.document).toContain("farewell")
  })

  /**
   * A migrated Project is in this build's format in memory only. Writing it is
   * what makes the migration stick, and the backup taken on the way in is what
   * makes that safe.
   */
  it("writes a Project that had to be brought up to date, without an edit", async () => {
    const store = fakeProjectStore([helloProject()])
    const { result } = renderHook(() => {
      const editor = useProject(() => helloProject())
      return { editor, autosave: useAutosave(store, editor.project, { migrated: true }) }
    })

    await waitFor(() => {
      expect(result.current.autosave.saved).toBe(true)
    })
    expect(store.contents.get(helloProject().id)?.document).toBe(serializeProject(helloProject()))
  })
})
