// @vitest-environment jsdom

import { CURRENT_SCHEMA_VERSION, type Project } from "@bot-inventor/schema"
import { helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { fakeImportGateway } from "@/project/fake-import-gateway"
import { serializeProject } from "@/project/project-store"
import { useImport } from "@/project/use-import"

/**
 * The first half of an import: the file the user picked, and whether what is in
 * it is a Project this build can make sense of.
 *
 * Nothing here reaches storage — being taken in is `useProjects`' half — so
 * what these hold is only that a Project comes back whole and that a document
 * this build cannot read comes back as words instead.
 */

/** The hook, and the Project it read, if it read one. */
async function importing(gateway = fakeImportGateway()) {
  const { result } = renderHook(() => useImport(gateway))
  let incoming: Project | undefined
  await act(async () => {
    incoming = await result.current.choose()
  })
  return { result, incoming }
}

describe("reading a Project somebody sent", () => {
  it("hands back the Project in the file the user picked", async () => {
    const { result, incoming } = await importing(
      fakeImportGateway({
        path: "C:/sent/hello.botinv",
        contents: serializeProject(helloProject())
      })
    )

    expect(incoming).toEqual(helloProject())
    expect(result.current.problem).toBeUndefined()
  })

  it("reads the file the user picked and no other", async () => {
    const gateway = fakeImportGateway({
      path: "C:/sent/hello.botinv",
      contents: serializeProject(helloProject())
    })
    await importing(gateway)

    expect(gateway.chosen).toEqual(["C:/sent/hello.botinv"])
  })

  it("does nothing and says nothing when the user closes the dialog", async () => {
    const gateway = fakeImportGateway({ path: undefined })
    const { result, incoming } = await importing(gateway)

    expect(incoming).toBeUndefined()
    expect(gateway.chosen).toEqual([])
    expect(result.current.problem).toBeUndefined()
  })

  /**
   * A `.botinv` is a file like any other: it can be truncated halfway through a
   * copy, or be a holiday photo somebody renamed. The user is told, and nothing
   * is made out of it.
   */
  it("refuses a document that is not a Project, with a reason", async () => {
    const { result, incoming } = await importing(
      fakeImportGateway({ path: "C:/sent/broken.botinv", contents: "{ this is not JSON" })
    )

    expect(incoming).toBeUndefined()
    expect(result.current.problem).toBeDefined()
  })

  it("refuses a Project written by a build newer than this one", async () => {
    const { result, incoming } = await importing(
      fakeImportGateway({
        path: "C:/sent/tomorrow.botinv",
        contents: JSON.stringify({ ...helloProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 })
      })
    )

    expect(incoming).toBeUndefined()
    expect(result.current.problem).toBeDefined()
  })

  it("says why a file that could not be read did not open", async () => {
    const { result, incoming } = await importing(
      fakeImportGateway({ path: "C:/sent/gone.botinv", refuse: new Error("the file is gone") })
    )

    expect(incoming).toBeUndefined()
    expect(result.current.problem).toContain("the file is gone")
  })

  it("forgets a refusal once the user has been told", async () => {
    const { result } = await importing(
      fakeImportGateway({ path: "C:/sent/broken.botinv", contents: "not a Project" })
    )
    expect(result.current.problem).toBeDefined()

    act(() => result.current.forgetProblem())

    expect(result.current.problem).toBeUndefined()
  })

  // Two open dialogs at once are two imports racing to be the one the user is
  // asked about, and the loser vanishes without ever being seen.
  it("says it is working until the document has been read", async () => {
    let finish: (contents: string) => void = () => {}
    const gateway = fakeImportGateway({ path: "C:/sent/hello.botinv" })
    gateway.read = () => new Promise(resolve => (finish = resolve))

    const { result } = renderHook(() => useImport(gateway))
    expect(result.current.busy).toBe(false)

    let choosing: Promise<unknown> | undefined
    await act(async () => {
      choosing = result.current.choose()
    })
    expect(result.current.busy).toBe(true)

    await act(async () => {
      finish(serializeProject(helloProject()))
      await choosing
    })
    expect(result.current.busy).toBe(false)
  })
})
