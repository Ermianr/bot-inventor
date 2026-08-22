import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { translate } from "@/i18n/messages"
import { Console } from "@/session/console"
import type { SessionEntry } from "@/session/use-session"

/**
 * The Console: where the record of a running bot is read.
 *
 * What is held to here is what the user is promised — that every line is there,
 * that it is possible to tell who is talking, that the newest line is the one on
 * screen, and that the whole panel can be got out of the way. How it is drawn is
 * not.
 */

/** No DOM here lays anything out, so the one thing scrolling can be held to is the ask. */
const scroll = mock()

beforeEach(() => {
  scroll.mockClear()
  Element.prototype.scrollIntoView = scroll
})

afterEach(cleanup)

function entries(...tones: SessionEntry["tone"][]): readonly SessionEntry[] {
  return tones.map((tone, id) => ({ id, text: `line ${id}`, tone }))
}

function lines() {
  return screen.getAllByTestId(/^session-entry-/)
}

describe("the Console", () => {
  it("says there is nothing yet before the bot has said anything", () => {
    render(<Console entries={[]} />)

    expect(screen.getByText(translate("console.empty"))).toBeTruthy()
    expect(screen.queryAllByTestId(/^session-entry-/)).toHaveLength(0)
  })

  it("shows every line the Session has produced", () => {
    render(<Console entries={entries("output", "note", "problem")} />)

    expect(lines().map(line => line.textContent)).toEqual(["line 0", "line 1", "line 2"])
  })

  /**
   * The bot talking, the application talking and something being broken read as
   * three different things, so that a user can tell whose problem they have.
   */
  it("tells the bot's own output apart from the application's notes and from problems", () => {
    render(<Console entries={entries("output", "note", "problem")} />)

    expect(lines().map(line => line.dataset.tone)).toEqual(["output", "note", "problem"])
  })

  /** A bot that just broke says why at the bottom, where the user is looking. */
  it("follows its newest line as output arrives", () => {
    const { rerender } = render(<Console entries={entries("output")} />)
    scroll.mockClear()

    rerender(<Console entries={entries("output", "problem")} />)

    expect(scroll).toHaveBeenCalled()
  })

  /** A bot that would not start is the one thing the user is waiting to read. */
  it("says why the Session is not running, when it is not", () => {
    render(<Console entries={[]} problem="Discord did not accept that token." />)

    const said = screen.getByTestId("session-problem")

    expect(said.textContent).toBe("Discord did not accept that token.")
    expect(said.dataset.tone).toBe("problem")
    expect(screen.queryByText(translate("console.empty"))).toBeNull()
  })

  it("gives the Canvas the whole window when it is collapsed, and comes back", () => {
    render(<Console entries={entries("output")} />)

    fireEvent.click(screen.getByRole("button", { name: translate("console.collapse") }))

    expect(screen.queryByRole("tabpanel")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: translate("console.expand") }))

    expect(screen.getByRole("tabpanel")).toBeTruthy()
  })

  /**
   * Tracing joins this strip later. What that costs is one entry in the list of
   * panels, which is what this holds the shape to: the tab is a tab already,
   * rather than a title that would have to become one.
   */
  it("draws its panels as a tab strip, so a second one can join it", () => {
    render(<Console entries={[]} />)

    const tabs = screen.getAllByRole("tab")

    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0]?.id)
  })
})
