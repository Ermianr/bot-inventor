// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { translate } from "@/i18n/messages"
import { RunControls } from "@/session/run-controls"
import type { Session, SessionStatus } from "@/session/use-session"

/**
 * The two buttons that run the bot, and the light that says whether it is
 * running.
 *
 * They show no words, so what a screen reader is given is the whole of what
 * they say; and there are now two ways to press each of them — the button and
 * the key — which have to agree about when pressing is possible. Neither is
 * something the hook underneath can be held to.
 */

/** How many starts and stops were asked for. */
type Asked = { starts: number; stops: number }

function fakeSession(status: SessionStatus) {
  const asked: Asked = { starts: 0, stops: 0 }

  const session: Session = {
    status,
    entries: [],
    trace: undefined,
    problem: undefined,
    start: async () => {
      asked.starts += 1
    },
    stop: async () => {
      asked.stops += 1
    }
  }

  return { asked, session }
}

function renderControls(status: SessionStatus) {
  const { asked, session } = fakeSession(status)
  render(<RunControls session={session} />)
  return asked
}

/** The buttons as anybody who cannot see the icons finds them. */
function play() {
  return screen.getByRole("button", { name: translate("run.start") })
}

function stopButton() {
  return screen.getByRole("button", { name: translate("run.stop") })
}

afterEach(cleanup)

describe("the Run controls", () => {
  it("starts the bot asking for nothing", () => {
    const asked = renderControls("stopped")

    fireEvent.click(play())

    expect(asked.starts).toBe(1)
  })

  it("stops the bot that is running", () => {
    const asked = renderControls("ready")

    fireEvent.click(stopButton())

    expect(asked.stops).toBe(1)
  })

  /**
   * Neither button ever lies about what pressing it would do: a Play offered
   * over a running bot would start a second one, and a Stop offered over
   * nothing is a control that does nothing when pressed.
   */
  for (const status of ["connecting", "ready"] as const) {
    it(`offers only Stop while the bot is ${status}`, () => {
      renderControls(status)

      expect(play().hasAttribute("disabled")).toBe(true)
      expect(stopButton().hasAttribute("disabled")).toBe(false)
    })
  }

  for (const status of ["stopped", "failed"] as const) {
    it(`offers only Run while the bot is ${status}`, () => {
      renderControls(status)

      expect(play().hasAttribute("disabled")).toBe(false)
      expect(stopButton().hasAttribute("disabled")).toBe(true)
    })
  }

  it("shows which of the four things the bot is doing", () => {
    renderControls("connecting")

    const status = screen.getByTestId("run-status")

    expect(status.getAttribute("data-status")).toBe("connecting")
    expect(status.textContent).toBe(translate("run.status.connecting"))
  })
})

/**
 * The shortcuts, which are the same two presses a code editor answers to. They
 * are dead exactly while their button is: the key and the button are two ways
 * of asking for one thing, and they cannot disagree about whether it is on
 * offer.
 */
describe("running the bot from the keyboard", () => {
  it("starts the bot on F5", () => {
    const asked = renderControls("stopped")

    fireEvent.keyDown(window, { key: "F5" })

    expect(asked.starts).toBe(1)
  })

  it("stops the bot on Shift+F5", () => {
    const asked = renderControls("ready")

    fireEvent.keyDown(window, { key: "F5", shiftKey: true })

    expect(asked.stops).toBe(1)
  })

  /**
   * F5 is the browser's own reload, and the editor keeps it even when it has
   * nothing to do with it: letting it through while a bot is running would
   * reload the window and take the Session with it, which is the one press
   * that costs the user everything.
   */
  it("does not start a second bot on F5 while one is running, and does not let the browser have it", () => {
    const asked = renderControls("ready")

    const notSwallowed = fireEvent.keyDown(window, { key: "F5" })

    expect(asked.starts).toBe(0)
    expect(notSwallowed).toBe(false)
  })

  it("does not stop a bot that is not running", () => {
    const asked = renderControls("stopped")

    fireEvent.keyDown(window, { key: "F5", shiftKey: true })

    expect(asked.stops).toBe(0)
  })

  /** F5 with a modifier of somebody else's is somebody else's shortcut. */
  it("leaves F5 alone when it is held with another modifier", () => {
    const asked = renderControls("stopped")

    fireEvent.keyDown(window, { key: "F5", ctrlKey: true })

    expect(asked.starts).toBe(0)
  })

  it("runs the bot once while the key is held down", () => {
    const asked = renderControls("stopped")

    fireEvent.keyDown(window, { key: "F5" })
    fireEvent.keyDown(window, { key: "F5", repeat: true })

    expect(asked.starts).toBe(1)
  })
})
