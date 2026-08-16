// @vitest-environment jsdom

import type { ExportFormat } from "@bot-inventor/compiler"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MenuBar } from "@/components/menu-bar"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"
import type { ProjectFileEditor } from "@/project/use-project-file"

// The toaster itself belongs to the root route, so what the Menu Bar can be
// held to is which toast it raised and what it said.
type Raised = {
  kind: string
  message: string
  /** What the toast offers to do about it, when it offers anything. */
  action?: { label: string; onClick: () => void }
}
const raised: Raised[] = []
type Options = { action?: { label: string; onClick: () => void } }
vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => raised.push({ kind: "error", message }),
    success: (message: string, options?: Options) =>
      raised.push({ kind: "success", message, action: options?.action })
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
    showWritten: undefined,
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
 * The keyboard doing what the menu does.
 *
 * A shortcut drawn beside an entry and never registered is the interface lying
 * to the user, so both halves are held to here: that the keys are written where
 * they can be learned, and that pressing them does the thing.
 */
describe("the Project menu's shortcuts", () => {
  for (const [entry, key, shortcut] of [
    ["a new Project", "project.file.new", "project.file.new.shortcut"],
    ["opening one", "project.file.open", "project.file.open.shortcut"],
    ["saving", "project.file.save", "project.file.save.shortcut"],
    ["saving somewhere else", "project.file.saveAs", "project.file.saveAs.shortcut"]
  ] as const) {
    it(`writes the keys for ${entry} beside the entry`, async () => {
      const { file, exporting } = fakeEditors()
      render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

      openProjectMenu()

      const item = (await screen.findByText(translate(key))).closest("[role='menuitem']")
      expect(item?.textContent).toContain(translate(shortcut))
    })
  }

  for (const [keys, press, expected] of [
    ["Ctrl+N", { key: "n" }, "create"],
    ["Ctrl+O", { key: "o" }, "open"],
    ["Ctrl+S", { key: "s" }, "save"],
    ["Ctrl+Shift+S", { key: "S", shiftKey: true }, "saveAs"]
  ] as const) {
    it(`asks for ${expected} when ${keys} is pressed`, async () => {
      const { asked, file, exporting } = fakeEditors()
      render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

      await act(async () => {
        fireEvent.keyDown(window, { ctrlKey: true, ...press })
      })

      expect(asked.file).toEqual([expected])
    })
  }

  /**
   * The Project name is a text field on the row itself, so it is the field a
   * user is most likely to be inside when they reach for one of these.
   */
  it("does nothing but save while the bot's name is being typed", async () => {
    const { asked, file, exporting } = fakeEditors()
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    fireEvent.click(screen.getByTestId("project-name-edit"))
    const field = await screen.findByTestId("project-name-field")

    for (const press of [{ key: "n" }, { key: "o" }, { key: "S", shiftKey: true }]) {
      await act(async () => {
        fireEvent.keyDown(field, { ctrlKey: true, ...press })
      })
    }
    expect(asked.file).toEqual([])

    await act(async () => {
      fireEvent.keyDown(field, { ctrlKey: true, key: "s" })
    })
    await settle()
    expect(asked.file).toEqual(["save"])
  })

  /**
   * The name is only handed over when the field loses the focus, so a Save that
   * read the Project straight away would write the name from before the edit —
   * which is the very edit the user pressed Ctrl+S to keep.
   */
  it("saves the name the user has just typed, not the one it is replacing", async () => {
    const { file, exporting } = fakeEditors()
    const stored: string[] = []

    /** Holds the name the way the editor does, so Save can read what it is now. */
    function Editing() {
      const [name, setName] = useState("Bot")
      return (
        <MenuBar
          name={name}
          onRename={setName}
          file={{
            ...file,
            save: async () => {
              stored.push(name)
            }
          }}
          exporting={exporting}
        />
      )
    }

    render(<Editing />)
    fireEvent.click(screen.getByTestId("project-name-edit"))
    const field = await screen.findByTestId("project-name-field")

    await act(async () => {
      fireEvent.change(field, { target: { value: "Helper" } })
    })
    await act(async () => {
      fireEvent.keyDown(field, { ctrlKey: true, key: "s" })
    })
    await settle()

    expect(stored).toEqual(["Helper"])
  })

  /**
   * "From anywhere in the editor" includes the menu the shortcut is written in:
   * the popup is where a user reading the keys for the first time is standing.
   */
  it("still saves while the Project menu is open", async () => {
    const { asked, file, exporting } = fakeEditors()
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    openProjectMenu()
    const entry = await screen.findByText(translate("project.file.save"))
    await act(async () => {
      fireEvent.keyDown(entry, { ctrlKey: true, key: "s" })
    })

    expect(asked.file).toEqual(["save"])
  })
})

/** Lets a Save that waited for a field to give up its name arrive. */
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve))
  })
}

/**
 * The View menu holds what the editor shows and what it looks like, and what
 * each entry does is covered where that entry is. What only the Menu Bar can be
 * held to is that View is on the row at all and that both hang under it.
 */
describe("the View menu", () => {
  for (const [what, key] of [
    ["the theme is chosen", "theme.title"],
    ["the Minimap is turned on and off", "minimap.title"]
  ] as const) {
    it(`is where ${what}`, async () => {
      const { file, exporting } = fakeEditors()
      render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

      fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.view") }))

      expect(await screen.findByText(translate(key))).toBeDefined()
    })
  }
})

/**
 * The Help menu, which holds About. What About says is covered where it is;
 * what only the Menu Bar can be held to is that the entry opens it at all — the
 * dialog is a sibling of the menu that is closing under it, which is exactly
 * the wiring that can be got wrong without anything failing to type-check.
 */
describe("the Help menu", () => {
  it("opens About", async () => {
    const { file, exporting } = fakeEditors()
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    expect(screen.queryByTestId("about-dialog")).toBeNull()

    fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.help") }))
    await pick(translate("about.menu"))

    expect(await screen.findByTestId("about-dialog")).toBeDefined()
  })

  it("tells About where this Project is saved", async () => {
    const { file, exporting } = fakeEditors({}, { path: "C:/bots/helper.botinv" })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.help") }))
    await pick(translate("about.menu"))

    const where = await screen.findByTestId("about-project")
    expect(where.textContent).toBe("C:/bots/helper.botinv")
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

  it("offers to open the folder the export went to", () => {
    let opened = 0
    const { file, exporting } = fakeEditors({
      written: "Written to C:/bots/bot.mjs",
      showWritten: async () => {
        opened += 1
      }
    })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    const [announced] = raised
    expect(announced?.message).toBe("Written to C:/bots/bot.mjs")
    expect(announced?.action?.label).toBe(translate("export.show"))

    announced?.action?.onClick()
    expect(opened).toBe(1)
  })

  // In a plain browser there is no folder to open, and the message still has to
  // arrive: where the Export went is the whole of what the user is owed.
  it("still says where the export went when nothing can open it", () => {
    const { file, exporting } = fakeEditors({ written: "Written to C:/bots/bot.mjs" })
    render(<MenuBar name="Bot" onRename={() => {}} file={file} exporting={exporting} />)

    expect(raised[0]?.message).toBe("Written to C:/bots/bot.mjs")
    expect(raised[0]?.action).toBeUndefined()
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
