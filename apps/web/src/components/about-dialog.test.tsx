import { afterEach, describe, expect, it, mock } from "bun:test"

import { cleanup, render, screen } from "@testing-library/react"

import type { Application } from "@/about/application"
import { translate } from "@/i18n/messages"

/**
 * About, as the person it is written for reads it.
 *
 * What it says is the point of it: somebody who does not program is asked what
 * they are running, and every line here is one of the answers. A line that is
 * silently missing — because the desktop shell could not say — is the failure
 * this guards against, so the unknown ones are held to saying so.
 */

/** What the desktop shell answered this run, which the tests set per case. */
let described: Application = { version: undefined, nodeVersion: undefined }

/** Whether the shell took charge of the repository link, as it does on the desktop. */
let opensRepository = false

/**
 * `mock.module` is not hoisted the way `vi.mock` was, so it runs where it is
 * written and the dialog is imported after it rather than beside it. A static
 * import would have been evaluated first and would have closed over the real
 * module.
 */
const application = await import("@/about/application")

await mock.module("@/about/application", () => ({
  ...application,
  useApplication: () => described,
  openRepository: () => opensRepository
}))

const { AboutDialog } = await import("@/components/about-dialog")

afterEach(() => {
  described = { version: undefined, nodeVersion: undefined }
  opensRepository = false
  cleanup()
})

/** The dialog as the Menu Bar opens it. */
function open() {
  render(<AboutDialog open onOpenChange={() => {}} />)
}

describe("About", () => {
  it("says what the application is called", () => {
    open()

    expect(screen.getByTestId("about-name").textContent).toBe("Bot Inventor")
  })

  it("says which version of the application this is", () => {
    described = { version: "0.1.0", nodeVersion: "22.20.0" }
    open()

    expect(screen.getByTestId("about-version").textContent).toBe("0.1.0")
  })

  it("says the licence the application is under", () => {
    open()

    expect(screen.getByTestId("about-licence").textContent).toBe("MIT")
  })

  it("says which Node.js the Sidecar runs the bot on", () => {
    described = { version: "0.1.0", nodeVersion: "22.20.0" }
    open()

    expect(screen.getByTestId("about-node").textContent).toBe("22.20.0")
  })

  it("links to the repository, opened away from the editor", () => {
    open()

    const link = screen.getByTestId("about-repository").querySelector("a")
    expect(link?.getAttribute("href")).toBe("https://github.com/Ermianr/bot-inventor")
    expect(link?.getAttribute("target")).toBe("_blank")
  })

  /**
   * A webview has no browser around it, so following the link in place would
   * take the editor off the screen with no way back. The desktop shell hands
   * the address to the operating system instead, and the click has to stop
   * here for that to be the only thing that happens.
   */
  it("leaves the repository to the shell when there is one to open it", () => {
    opensRepository = true
    open()

    const link = screen.getByTestId("about-repository").querySelector("a")
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })
    link?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
  })

  it("lets the link be a link when nothing else will open it", () => {
    open()

    const link = screen.getByTestId("about-repository").querySelector("a")
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })
    link?.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
  })

  /**
   * The editor also runs in a plain browser, where there is no shell to ask.
   * Blank lines there would read as an application that has no version.
   */
  it("says so about anything it could not find out", () => {
    open()

    expect(screen.getByTestId("about-version").textContent).toBe(translate("about.unknown"))
    expect(screen.getByTestId("about-node").textContent).toBe(translate("about.unknown"))
  })

  it("is not on the screen until it is opened", () => {
    render(<AboutDialog open={false} onOpenChange={() => {}} />)

    expect(screen.queryByTestId("about-dialog")).toBeNull()
  })
})
