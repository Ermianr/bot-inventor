// @vitest-environment jsdom

import type { ExportRequest, ExportResult } from "@bot-inventor/compiler"
import { helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ExportGateway } from "@/project/export-gateway"
import { useExport } from "@/project/use-export"

/**
 * Exporting, driven the way the toolbar drives it, with the two things only the
 * user can answer — where it goes, and whether an Export already there may be
 * replaced — answered by the test instead.
 */

type Answers = {
  destination?: string
  overwrite?: boolean
  /** What the exporter says, in the order it is asked. */
  results?: readonly ExportResult[]
}

function fakeGateway(answers: Answers = {}) {
  const asked: ExportRequest[] = []
  const warned: string[] = []
  let next = 0

  const gateway: ExportGateway = {
    chooseDestination: async () => answers.destination,
    confirmOverwrite: async path => {
      warned.push(path)
      return answers.overwrite ?? false
    },
    run: async request => {
      asked.push(request)
      return (
        answers.results?.[next++] ?? {
          kind: "exported",
          format: request.format,
          path: `${request.outputDirectory}/bot.mjs`
        }
      )
    }
  }

  return { gateway, asked, warned }
}

const EXISTS: ExportResult = {
  kind: "refused",
  reason: "already-exists",
  message: "An Export already exists there."
}

describe("exporting", () => {
  it("writes where the user chose and says where it went", async () => {
    const shell = fakeGateway({ destination: "C:/bots" })
    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    await act(() => exporting.result.current.exportAs("single-file"))

    expect(shell.asked).toHaveLength(1)
    expect(shell.asked[0]?.outputDirectory).toBe("C:/bots")
    expect(exporting.result.current.written).toContain("C:/bots/bot.mjs")
    expect(exporting.result.current.problem).toBeUndefined()
  })

  it("offers both formats", async () => {
    const shell = fakeGateway({ destination: "C:/bots" })
    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    await act(() => exporting.result.current.exportAs("single-file"))
    await act(() => exporting.result.current.exportAs("node-project"))

    expect(shell.asked.map(request => request.format)).toEqual(["single-file", "node-project"])
  })

  it("does nothing when the user closes the dialog", async () => {
    const shell = fakeGateway({ destination: undefined })
    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    await act(() => exporting.result.current.exportAs("single-file"))

    expect(shell.asked).toHaveLength(0)
    expect(exporting.result.current.written).toBeUndefined()
  })

  it("warns before writing over an Export that is already there", async () => {
    const shell = fakeGateway({
      destination: "C:/bots",
      overwrite: true,
      results: [EXISTS]
    })
    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    await act(() => exporting.result.current.exportAs("single-file"))

    expect(shell.warned).toEqual(["C:/bots"])
    // Asked again, and only the second time with permission to replace.
    expect(shell.asked.map(request => request.overwrite)).toEqual([undefined, true])
    expect(exporting.result.current.written).toBeDefined()
  })

  it("leaves the Export that is there alone when the user says no", async () => {
    const shell = fakeGateway({
      destination: "C:/bots",
      overwrite: false,
      results: [EXISTS]
    })
    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    await act(() => exporting.result.current.exportAs("single-file"))

    expect(shell.warned).toEqual(["C:/bots"])
    expect(shell.asked).toHaveLength(1)
    expect(exporting.result.current.written).toBeUndefined()
    expect(exporting.result.current.problem).toBeUndefined()
  })

  it("says why an Export that failed did not happen", async () => {
    const shell = fakeGateway({
      destination: "C:/bots",
      results: [{ kind: "refused", reason: "failed", message: "the disk is full" }]
    })
    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    await act(() => exporting.result.current.exportAs("single-file"))

    expect(exporting.result.current.problem).toContain("the disk is full")
    expect(exporting.result.current.written).toBeUndefined()
  })

  it("says it is working, because bundling is not instant", async () => {
    let finish: (result: ExportResult) => void = () => {}
    const shell = fakeGateway({ destination: "C:/bots" })
    shell.gateway.run = () => new Promise(resolve => (finish = resolve))

    const exporting = renderHook(() => useExport(helloProject(), shell.gateway))

    let exportingNow: Promise<void> | undefined
    await act(async () => {
      exportingNow = exporting.result.current.exportAs("single-file")
    })
    expect(exporting.result.current.busy).toBe(true)

    await act(async () => {
      finish({ kind: "exported", format: "single-file", path: "C:/bots/bot.mjs" })
      await exportingNow
    })
    expect(exporting.result.current.busy).toBe(false)
  })
})
