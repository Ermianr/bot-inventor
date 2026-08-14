// @vitest-environment jsdom

import type { Project } from "@bot-inventor/schema"
import { futureVersionProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { type ProjectFileGateway, serializeProject } from "@/project/project-file"
import { useProject } from "@/project/use-project"
import { useProjectFile } from "@/project/use-project-file"

/**
 * The Project's life as a file, driven the way the toolbar drives it, with the
 * two things only the user can answer — which file, and whether unsaved work
 * may go — answered by the test instead.
 */

type Answers = {
  savePath?: string
  openPath?: string
  discard?: boolean
}

function fakeGateway(files: Record<string, string>, answers: Answers = {}) {
  const asked: string[] = []

  const gateway: ProjectFileGateway = {
    read: async path => {
      const contents = files[path]
      if (contents === undefined) throw new Error(`no such file: ${path}`)
      return contents
    },
    write: async (path, contents) => {
      files[path] = contents
    },
    backUp: async path => {
      files[`${path}.backup`] = files[path] ?? ""
      return `${path}.backup`
    },
    chooseSavePath: async () => {
      asked.push("save-path")
      return answers.savePath
    },
    chooseOpenPath: async () => {
      asked.push("open-path")
      return answers.openPath
    },
    confirmDiscard: async () => {
      asked.push("discard")
      return answers.discard ?? false
    }
  }

  return { gateway, files, asked }
}

/** The editor and its file, as the route wires them together. */
function editorWith(files: ProjectFileGateway, initial: Project = helloProject()) {
  return renderHook(() => {
    const editor = useProject(() => initial)
    return { editor, file: useProjectFile(editor, files) }
  })
}

describe("saving a Project", () => {
  it("asks where to put a Project that has never been saved, and remembers it", async () => {
    const { gateway, files, asked } = fakeGateway({}, { savePath: "C:/bots/hello.botinv" })
    const { result } = editorWith(gateway)

    await act(() => result.current.file.save())
    expect(files["C:/bots/hello.botinv"]).toBe(serializeProject(helloProject()))
    expect(result.current.file.path).toBe("C:/bots/hello.botinv")

    await act(() => result.current.file.save())
    expect(asked).toEqual(["save-path"])
  })

  it("leaves the file alone when the user closes the save dialog", async () => {
    const { gateway, files } = fakeGateway({}, { savePath: undefined })
    const { result } = editorWith(gateway)

    await act(() => result.current.file.save())

    expect(files).toEqual({})
    expect(result.current.file.path).toBeUndefined()
  })

  it("has unsaved changes from the moment the Canvas is edited until it is saved", async () => {
    const { gateway } = fakeGateway({}, { savePath: "C:/bots/hello.botinv" })
    const { result } = editorWith(gateway)

    expect(result.current.file.saved).toBe(true)

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))
    expect(result.current.file.saved).toBe(false)

    await act(() => result.current.file.save())
    expect(result.current.file.saved).toBe(true)
  })

  it("says so when the file could not be written", async () => {
    const { gateway } = fakeGateway({}, { savePath: "C:/bots/hello.botinv" })
    gateway.write = async () => {
      throw new Error("the disk is full")
    }
    const { result } = editorWith(gateway)

    await act(() => result.current.file.save())

    expect(result.current.file.problem).toContain("the disk is full")
    expect(result.current.file.path).toBeUndefined()
  })
})

describe("opening a Project", () => {
  it("puts the Project that was saved back on the Canvas", async () => {
    const saved = helloProject()
    const { gateway } = fakeGateway(
      { "C:/bots/hello.botinv": serializeProject(saved) },
      { openPath: "C:/bots/hello.botinv" }
    )
    const { result } = editorWith(gateway, { ...helloProject(), name: "Something else" })

    await act(() => result.current.file.open())

    expect(result.current.editor.project).toEqual(saved)
    expect(result.current.file.path).toBe("C:/bots/hello.botinv")
    expect(result.current.file.saved).toBe(true)
  })

  it("explains a Project from a newer build and keeps the one on the Canvas", async () => {
    const { gateway, files } = fakeGateway(
      { "C:/bots/future.botinv": JSON.stringify(futureVersionProject()) },
      { openPath: "C:/bots/future.botinv" }
    )
    const before = { ...files }
    const { result } = editorWith(gateway)

    await act(() => result.current.file.open())

    expect(result.current.file.problem).toContain("newer version")
    expect(result.current.editor.project).toEqual(helloProject())
    expect(files).toEqual(before)
  })

  it("explains a file that is not a Project", async () => {
    const { gateway } = fakeGateway(
      { "C:/bots/broken.botinv": "not a project" },
      { openPath: "C:/bots/broken.botinv" }
    )
    const { result } = editorWith(gateway)

    await act(() => result.current.file.open())

    expect(result.current.file.problem).toBeDefined()
    expect(result.current.editor.project).toEqual(helloProject())
  })
})

describe("work that has not been saved", () => {
  it("asks before opening another Project, and stops when the user says no", async () => {
    const { gateway, asked } = fakeGateway(
      { "C:/bots/other.botinv": serializeProject(helloProject()) },
      { openPath: "C:/bots/other.botinv", discard: false }
    )
    const { result } = editorWith(gateway)

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))
    await act(() => result.current.file.open())

    expect(asked).toEqual(["discard"])
    expect(result.current.editor.project.flows[0]?.nodes[0]?.fields.name).toBe("goodbye")
  })

  it("asks before starting a new Project, and starts an empty one when the user agrees", async () => {
    const { gateway } = fakeGateway({}, { discard: true })
    const { result } = editorWith(gateway)

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))
    await act(() => result.current.file.create())

    expect(result.current.editor.project.flows).toHaveLength(1)
    expect(result.current.editor.project.flows[0]?.nodes).toEqual([])
    expect(result.current.editor.project.id).not.toBe(helloProject().id)
    expect(result.current.file.saved).toBe(true)
  })

  it("lets the application close when nothing would be lost, and asks when something would", async () => {
    const { gateway } = fakeGateway({}, { discard: false })
    const { result } = editorWith(gateway)

    await expect(result.current.file.confirmDiscard()).resolves.toBe(true)

    act(() => result.current.editor.setNodeField("node-trigger", "name", "goodbye"))

    await expect(result.current.file.confirmDiscard()).resolves.toBe(false)
  })
})
