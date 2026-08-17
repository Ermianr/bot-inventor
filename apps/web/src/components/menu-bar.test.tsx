// @vitest-environment jsdom

import type { ExportFormat } from "@bot-inventor/compiler"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MenuBar } from "@/components/menu-bar"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"
import type { Sharing } from "@/project/use-share"

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

/** Every Export the Menu Bar asked for, in the order it asked. */
type Asked = { exports: ExportFormat[] }

/** How many times the row asked for the Project to be shared. */
type Shared = { count: number }

function fakeSharing(overrides: Partial<Sharing> = {}) {
  const shared: Shared = { count: 0 }

  const sharing: Sharing = {
    written: undefined,
    problem: undefined,
    share: async () => {
      shared.count += 1
    },
    ...overrides
  }

  return { shared, sharing }
}

function fakeExporting(overrides: Partial<Exporting> = {}) {
  const asked: Asked = { exports: [] }

  const exporting: Exporting = {
    written: undefined,
    problem: undefined,
    busy: false,
    showWritten: undefined,
    exportAs: async format => {
      asked.exports.push(format)
    },
    ...overrides
  }

  return { asked, exporting }
}

/** The row as the editor renders it, with only what a test is about changed. */
function renderMenuBar(
  exporting: Exporting,
  overrides: {
    onDashboard?: () => void
    onOptions?: () => void
    problem?: string
    sharing?: Sharing
  } = {}
) {
  return render(
    <MenuBar
      name="Bot"
      onDashboard={overrides.onDashboard ?? (() => {})}
      onOptions={overrides.onOptions ?? (() => {})}
      saved
      problem={overrides.problem}
      exporting={exporting}
      sharing={overrides.sharing ?? fakeSharing().sharing}
    />
  )
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
  /**
   * The one way out of the editor. With the application owning where Projects
   * live, this entry stands in for New, Open, Save and Save as… all four at
   * once, so an entry that is on the row and wired to nothing strands the user
   * inside the Project they opened.
   */
  it("takes the user back to the Dashboard", async () => {
    let asked = 0
    const { exporting } = fakeExporting()
    renderMenuBar(exporting, {
      onDashboard: () => {
        asked += 1
      }
    })

    openProjectMenu()
    await pick(translate("menu.project.dashboard"))

    expect(asked).toBe(1)
  })

  /**
   * The only way to Project Options: a token regenerated in the Discord portal
   * has nowhere else to be typed once the Project exists.
   */
  it("opens Project Options", async () => {
    let asked = 0
    const { exporting } = fakeExporting()
    renderMenuBar(exporting, {
      onOptions: () => {
        asked += 1
      }
    })

    openProjectMenu()
    await pick(translate("project.options.title"))

    expect(asked).toBe(1)
  })

  for (const [entry, key, expected] of [
    ["a Single File", "export.singleFile", "single-file"],
    ["a Node Project", "export.nodeProject", "node-project"]
  ] as const) {
    it(`asks for ${entry} when that is the format picked`, async () => {
      const { asked, exporting } = fakeExporting()
      renderMenuBar(exporting)

      openProjectMenu()
      await pick(translate("export.title"))
      await pick(translate(key))

      expect(asked.exports).toEqual([expected])
    })
  }

  it("explains each Export format, because that is what makes the choice possible", async () => {
    const { exporting } = fakeExporting()
    renderMenuBar(exporting)

    openProjectMenu()
    await pick(translate("export.title"))

    expect(await screen.findByText(translate("export.singleFile.help"))).toBeDefined()
    expect(await screen.findByText(translate("export.nodeProject.help"))).toBeDefined()
  })

  /**
   * Share and Export are two different offers on one menu, and the entry that
   * is wired to the wrong one is the mistake nothing else catches: both are
   * "give this bot to somebody", and only one of them writes a Project File.
   */
  it("shares the Project when Share is picked", async () => {
    const { asked, exporting } = fakeExporting()
    const { shared, sharing } = fakeSharing()
    renderMenuBar(exporting, { sharing })

    openProjectMenu()
    await pick(translate("share.title"))

    expect(shared.count).toBe(1)
    // And nothing was Exported: the two entries are not the same offer.
    expect(asked.exports).toEqual([])
  })

  it("says it is working and cannot be asked again while it is", async () => {
    const { exporting } = fakeExporting({ busy: true })
    renderMenuBar(exporting)

    openProjectMenu()

    const trigger = await screen.findByText(translate("export.working"))
    expect(trigger.closest("[data-disabled]")).not.toBeNull()
  })
})

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
      const { exporting } = fakeExporting()
      renderMenuBar(exporting)

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
    const { exporting } = fakeExporting()
    renderMenuBar(exporting)

    expect(screen.queryByTestId("about-dialog")).toBeNull()

    fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.help") }))
    await pick(translate("about.menu"))

    expect(await screen.findByTestId("about-dialog")).toBeDefined()
  })
})

/**
 * What an action has to say back. It used to be a line inside the row, and the
 * row is now a Menu Bar with nowhere to put one — so a message that never
 * reaches the toaster is a failure the user is never told about.
 */
describe("what the Menu Bar says back", () => {
  it("stays quiet while there is nothing to say", () => {
    const { exporting } = fakeExporting()
    renderMenuBar(exporting)

    expect(raised).toEqual([])
  })

  /**
   * Autosave is the one thing in the editor that can lose work without anybody
   * pressing anything, so a write that did not happen is the message that
   * matters most on this row.
   */
  it("says a write that did not happen, the moment it did not", () => {
    const { exporting } = fakeExporting()
    renderMenuBar(exporting, { problem: "This Project could not be saved." })

    expect(raised).toEqual([{ kind: "error", message: "This Project could not be saved." }])
  })

  it("says an export problem the moment there is one", () => {
    const { exporting } = fakeExporting({ problem: "Your bot could not be exported." })
    renderMenuBar(exporting)

    expect(raised).toEqual([{ kind: "error", message: "Your bot could not be exported." }])
  })

  it("says where an export was written", () => {
    const { exporting } = fakeExporting({ written: "Written to C:/bots/bot.mjs" })
    renderMenuBar(exporting)

    expect(raised).toEqual([{ kind: "success", message: "Written to C:/bots/bot.mjs" }])
  })

  it("offers to open the folder the export went to", () => {
    let opened = 0
    const { exporting } = fakeExporting({
      written: "Written to C:/bots/bot.mjs",
      showWritten: async () => {
        opened += 1
      }
    })
    renderMenuBar(exporting)

    const [announced] = raised
    expect(announced?.message).toBe("Written to C:/bots/bot.mjs")
    expect(announced?.action?.label).toBe(translate("export.show"))

    announced?.action?.onClick()
    expect(opened).toBe(1)
  })

  // In a plain browser there is no folder to open, and the message still has to
  // arrive: where the Export went is the whole of what the user is owed.
  it("still says where the export went when nothing can open it", () => {
    const { exporting } = fakeExporting({ written: "Written to C:/bots/bot.mjs" })
    renderMenuBar(exporting)

    expect(raised[0]?.message).toBe("Written to C:/bots/bot.mjs")
    expect(raised[0]?.action).toBeUndefined()
  })

  it("says where the Project was shared", () => {
    const { exporting } = fakeExporting()
    const { sharing } = fakeSharing({ written: "Shared to C:/shared/bot.botinv" })
    renderMenuBar(exporting, { sharing })

    expect(raised).toEqual([{ kind: "success", message: "Shared to C:/shared/bot.botinv" }])
  })

  // A Share that failed is a file the user believes they have and does not.
  it("says a Share that did not happen", () => {
    const { exporting } = fakeExporting()
    const { sharing } = fakeSharing({ problem: "Your bot could not be shared." })
    renderMenuBar(exporting, { sharing })

    expect(raised).toEqual([{ kind: "error", message: "Your bot could not be shared." }])
  })

  it("says the same problem again when it happens again", () => {
    const problem = "This Project could not be saved."
    const { exporting } = fakeExporting()

    // What the hook underneath does between two goes at the same thing: the
    // message is dropped before the next write is attempted, and comes back
    // when that one fails the same way. A user losing work twice is told twice.
    const { sharing } = fakeSharing()
    const view = renderMenuBar(exporting, { problem, sharing })
    view.rerender(
      <MenuBar
        name="Bot"
        onDashboard={() => {}}
        onOptions={() => {}}
        saved
        problem={undefined}
        exporting={exporting}
        sharing={sharing}
      />
    )
    view.rerender(
      <MenuBar
        name="Bot"
        onDashboard={() => {}}
        onOptions={() => {}}
        saved={false}
        problem={problem}
        exporting={exporting}
        sharing={sharing}
      />
    )

    expect(raised).toEqual([
      { kind: "error", message: problem },
      { kind: "error", message: problem }
    ])
  })
})
