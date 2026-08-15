// @vitest-environment jsdom

import type { ExportFormat } from "@bot-inventor/compiler"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ExportButton } from "@/components/export-button"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"

/**
 * The Export button, pressed the way a user presses it.
 *
 * `use-export.test.ts` covers what happens once a format has been asked for;
 * this covers the step before it, which is the one nothing else can see. The
 * menu comes from a library, the handler is a prop name that library decides,
 * and the wrong name type-checks and does nothing — the button goes quiet and
 * no test of the hook underneath it notices.
 */

function fakeExporting(overrides: Partial<Exporting> = {}) {
  const asked: ExportFormat[] = []

  const exporting: Exporting = {
    written: undefined,
    problem: undefined,
    busy: false,
    exportAs: async format => {
      asked.push(format)
    },
    ...overrides
  }

  return { exporting, asked }
}

// Testing Library only registers its own cleanup when Vitest runs with
// globals, and this project imports everything explicitly instead. Without
// this the menu of one test is still in the document during the next, and the
// button it is looking for is there twice.
afterEach(cleanup)

/** Opens the menu and picks the entry with that label. */
async function pick(label: string) {
  fireEvent.click(screen.getByRole("button", { name: translate("export.title") }))
  const item = await screen.findByText(label)
  await act(async () => {
    fireEvent.click(item)
  })
}

describe("the Export button", () => {
  it("asks for a Single File when that is the one picked", async () => {
    const { exporting, asked } = fakeExporting()
    render(<ExportButton exporting={exporting} />)

    await pick(translate("export.singleFile"))

    expect(asked).toEqual(["single-file"])
  })

  it("asks for a Node Project when that is the one picked", async () => {
    const { exporting, asked } = fakeExporting()
    render(<ExportButton exporting={exporting} />)

    await pick(translate("export.nodeProject"))

    expect(asked).toEqual(["node-project"])
  })

  it("says it is working and cannot be pressed again while it is", () => {
    const { exporting } = fakeExporting({ busy: true })
    render(<ExportButton exporting={exporting} />)

    const button = screen.getByRole("button", { name: translate("export.working") })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
