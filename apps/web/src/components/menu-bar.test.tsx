// @vitest-environment jsdom

import type { ExportFormat } from "@bot-inventor/compiler"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { MenuBar } from "@/components/menu-bar"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"
import type { ProjectFileEditor } from "@/project/use-project-file"

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

function fakeEditors(exportOverrides: Partial<Exporting> = {}) {
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
    confirmDiscard: async () => true
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
