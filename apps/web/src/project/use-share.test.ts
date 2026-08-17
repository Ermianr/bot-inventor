// @vitest-environment jsdom

import { projectSchema } from "@bot-inventor/schema"
import { helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ShareGateway } from "@/project/share-gateway"
import { suggestedFileName, withProjectFileExtension } from "@/project/share-gateway"
import { useShare } from "@/project/use-share"

/**
 * Sharing, driven the way the Menu Bar drives it, with the one thing only the
 * user can answer — where the Project File goes — answered by the test.
 */

type Answers = {
  destination?: string
  /** What the write does instead of succeeding, when it does not. */
  refuse?: Error
}

function fakeGateway(answers: Answers = {}) {
  const asked: string[] = []
  const wrote: { path: string; document: string }[] = []

  const gateway: ShareGateway = {
    chooseDestination: async suggested => {
      asked.push(suggested)
      return answers.destination
    },
    write: async (path, document) => {
      if (answers.refuse !== undefined) throw answers.refuse
      wrote.push({ path, document })
    }
  }

  return { gateway, asked, wrote }
}

describe("sharing a Project", () => {
  it("writes the Project where the user chose and says where it went", async () => {
    const shell = fakeGateway({ destination: "C:/shared/hello.botinv" })
    const sharing = renderHook(() => useShare(helloProject(), shell.gateway))

    await act(() => sharing.result.current.share())

    expect(shell.wrote.map(written => written.path)).toEqual(["C:/shared/hello.botinv"])
    expect(sharing.result.current.written).toContain("C:/shared/hello.botinv")
    expect(sharing.result.current.problem).toBeUndefined()
  })

  /**
   * The whole promise of Share: the file can be attached to a message without
   * the user checking anything first. So what was written is parsed back and
   * held to being a Project — every key of one, and not one key more. A Secret
   * or a Test Server that ever leaked into the document would show up here as a
   * key the Project format does not have.
   */
  it("writes a Project and nothing else", async () => {
    const project = helloProject()
    const shell = fakeGateway({ destination: "C:/shared/hello.botinv" })
    const sharing = renderHook(() => useShare(project, shell.gateway))

    await act(() => sharing.result.current.share())

    const document: unknown = JSON.parse(shell.wrote[0]?.document ?? "")
    expect(projectSchema.parse(document)).toEqual(project)
    expect(Object.keys(document as object).sort()).toEqual(
      ["flows", "id", "name", "schemaVersion"].sort()
    )
  })

  it("offers a file name made from the Project's name", async () => {
    const project = { ...helloProject(), name: "My first bot" }
    const shell = fakeGateway({ destination: "C:/shared/anything.botinv" })
    const sharing = renderHook(() => useShare(project, shell.gateway))

    await act(() => sharing.result.current.share())

    expect(shell.asked).toEqual(["My first bot.botinv"])
  })

  it("does nothing and says nothing when the user closes the dialog", async () => {
    const shell = fakeGateway({ destination: undefined })
    const sharing = renderHook(() => useShare(helloProject(), shell.gateway))

    await act(() => sharing.result.current.share())

    expect(shell.wrote).toEqual([])
    expect(sharing.result.current.written).toBeUndefined()
    expect(sharing.result.current.problem).toBeUndefined()
  })

  it("says why a Share that failed did not happen", async () => {
    const shell = fakeGateway({
      destination: "C:/shared/hello.botinv",
      refuse: new Error("the disk is full")
    })
    const sharing = renderHook(() => useShare(helloProject(), shell.gateway))

    await act(() => sharing.result.current.share())

    expect(sharing.result.current.problem).toContain("the disk is full")
    expect(sharing.result.current.written).toBeUndefined()
  })

  // Asking twice while the dialog is still open is two dialogs and two writes
  // racing for whatever path each comes back with.
  it("says it is working until the file is on disk", async () => {
    let finish: () => void = () => {}
    const shell = fakeGateway({ destination: "C:/shared/hello.botinv" })
    shell.gateway.write = () => new Promise(resolve => (finish = () => resolve()))

    const sharing = renderHook(() => useShare(helloProject(), shell.gateway))
    expect(sharing.result.current.busy).toBe(false)

    let sharingNow: Promise<void> | undefined
    await act(async () => {
      sharingNow = sharing.result.current.share()
    })
    expect(sharing.result.current.busy).toBe(true)

    await act(async () => {
      finish()
      await sharingNow
    })
    expect(sharing.result.current.busy).toBe(false)
  })

  it("is done being busy when the user closes the dialog", async () => {
    const shell = fakeGateway({ destination: undefined })
    const sharing = renderHook(() => useShare(helloProject(), shell.gateway))

    await act(() => sharing.result.current.share())

    expect(sharing.result.current.busy).toBe(false)
  })
})

describe("the file name a Project is offered under", () => {
  it("keeps a name a file system can hold", () => {
    expect(suggestedFileName("My first bot")).toBe("My first bot.botinv")
  })

  it("replaces what a file name cannot hold", () => {
    expect(suggestedFileName('bot: "one/two"')).toBe("bot- -one-two-.botinv")
  })

  it("falls back rather than offering an empty name", () => {
    expect(suggestedFileName(" ... ")).toBe("project.botinv")
  })

  /**
   * What the user typed into the dialog is a name, not necessarily a Project
   * File: one without its extension is one the receiving machine does not know
   * how to open.
   */
  it("puts the extension back when the user left it off", () => {
    expect(withProjectFileExtension("C:/shared/bot")).toBe("C:/shared/bot.botinv")
  })

  it("leaves a name that already ends in it alone, however it is spelled", () => {
    expect(withProjectFileExtension("C:/shared/bot.botinv")).toBe("C:/shared/bot.botinv")
    expect(withProjectFileExtension("C:/shared/bot.BOTINV")).toBe("C:/shared/bot.BOTINV")
  })
})
