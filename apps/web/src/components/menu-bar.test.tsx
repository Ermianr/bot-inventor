// @vitest-environment jsdom

import type { ExportFormat } from "@bot-inventor/compiler"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MenuBar } from "@/components/menu-bar"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"
import type { ProjectFileEditor } from "@/project/use-project-file"

// The toaster itself belongs to the root route, so what the Menu Bar can be
// held to is which toast it raised and what it said.
const raised: { kind: string; message: string }[] = []
vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => raised.push({ kind: "error", message }),
    success: (message: string) => raised.push({ kind: "success", message })
  }
}))

/**
 * The Project menu, opened the way a user opens it.
 *
 * What each entry does is covered by the hooks underneath; what nothing else
 * can see is that the entry is wired to it at all. The menu comes from a
 * library, the handler is a prop name that library decides, and the wrong name
 * type-checks and does nothing — the entry goes quiet and no test of the hook
 * underneath it notices.
 */

/** Every call the Menu Bar can make, in the order it made them. */
type Asked = { file: string[]; exports: ExportFormat[] }

function fakeEditors(
  exportOverrides: Partial<Exporting> = {},
  fileOverrides: Partial<ProjectFileEditor> = {}
) {
  const asked: Asked = { file: [], exports: [] }
  const record = (what: string) => async () => {
    asked.file.push(what)
  }

  const file: ProjectFileEditor = {
    path: undefined,
    saved: true,
    problem: undefined,
    create: record("create"),
    open: record("open"),
    save: record("save"),
    saveAs: record("saveAs"),
    confirmDiscard: async () => true,
    ...fileOverrides
  }

  const exporting: Exporting = {
    written: undefined,
    problem: undefined,
    busy: false,
    exportAs: async format => {
      asked.exports.push(format)
    },
    ...exportOverrides
  }

  return { asked, file, exporting }
}

// Testing Library only registers its own cleanup when Vitest runs with globals,
// and this project imports everything explicitly instead. Without this the menu
// of one test is still in the document during the next, and the entry it is
// looking for is there twice.
afterEach(cleanup)
beforeEach(() => {
  raised.length = 0
})

/** Opens the Project menu. */
function openProjectMenu() {
  fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.project") }))
}

/** Clicks the entry showing that label, once a menu holding it is open. */
async function pick(label: string) {
  const item = await screen.findByText(label)
  await act(async () => {
    fireEvent.click(item)
  })
}

describe("the Project menu", () => {
  for (const [entry, key, expected] of [
    ["a new Project", "project.file.new", "create"],
    ["opening one", "project.file.open", "open"],
    ["saving", "project.file.save", "save"],
    ["saving somewhere else", "project.file.saveAs", "saveAs"]
  ] as const) {
    it(`asks the file editor for ${entry}`, async () => {
      const { asked, file, exporting } = fakeEditors()
      render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

      openProjectMenu()
      await pick(translate(key))

      expect(asked.file).toEqual([expected])
    })
  }

  for (const [entry, key, expected] of [
    ["a Single File", "export.singleFile", "single-file"],
    ["a Node Project", "export.nodeProject", "node-project"]
  ] as const) {
    it(`asks for ${entry} when that is the format picked`, async () => {
      const { asked, file, exporting } = fakeEditors()
      render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

      openProjectMenu()
      await pick(translate("export.title"))
      await pick(translate(key))

      expect(asked.exports).toEqual([expected])
    })
  }

  it("explains each Export format, because that is what makes the choice possible", async () => {
    const { file, exporting } = fakeEditors()
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    openProjectMenu()
    await pick(translate("export.title"))

    expect(await screen.findByText(translate("export.singleFile.help"))).toBeDefined()
    expect(await screen.findByText(translate("export.nodeProject.help"))).toBeDefined()
  })

  it("says it is working and cannot be asked again while it is", async () => {
    const { file, exporting } = fakeEditors({ busy: true })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    openProjectMenu()

    const trigger = await screen.findByText(translate("export.working"))
    expect(trigger.closest("[data-disabled]")).not.toBeNull()
  })
})

/**
 * The View menu holds the theme, and what it does with it is covered where the
 * menu itself is. What only the Menu Bar can be held to is that View is on the
 * row at all and that the theme hangs under it.
 */
describe("the View menu", () => {
  it("is where the theme is chosen", async () => {
    const { file, exporting } = fakeEditors()
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.view") }))

    expect(await screen.findByText(translate("theme.title"))).toBeDefined()
  })
})

/**
 * What an action has to say back. It used to be a line inside the row, and the
 * row is now a Menu Bar with nowhere to put one — so a message that never
 * reaches the toaster is a failure the user is never told about.
 */
describe("what the Menu Bar says back", () => {
  it("stays quiet while there is nothing to say", () => {
    const { file, exporting } = fakeEditors()
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    expect(raised).toEqual([])
  })

  it("says a file problem the moment there is one", () => {
    const { file, exporting } = fakeEditors({}, { problem: "This Project could not be saved." })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    expect(raised).toEqual([{ kind: "error", message: "This Project could not be saved." }])
  })

  it("says an export problem the moment there is one", () => {
    const { file, exporting } = fakeEditors({ problem: "Your bot could not be exported." })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    expect(raised).toEqual([{ kind: "error", message: "Your bot could not be exported." }])
  })

  it("says where an export was written", () => {
    const { file, exporting } = fakeEditors({ written: "Written to C:/bots/bot.mjs" })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    expect(raised).toEqual([{ kind: "success", message: "Written to C:/bots/bot.mjs" }])
  })

  it("says the same problem again when it happens again", () => {
    const problem = "This Project could not be saved."
    const { file, exporting } = fakeEditors()
    const failed = { ...file, problem }

    // What the hooks underneath do between two goes at the same thing: the
    // message is dropped when the next one is asked for, and comes back when it
    // fails the same way. A user who presses Save twice is told twice.
    const view = render(
      <MenuBar name="Bot" onRename={() => {}} file={failed} exporting={exporting} />
    )
    view.rerender(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)
    view.rerender(<MenuBar name="Bot" onRename={() => {}} file={failed} exporting={exporting} />)

    expect(raised).toEqual([
      { kind: "error", message: problem },
      { kind: "error", message: problem }
    ])
  })
})
