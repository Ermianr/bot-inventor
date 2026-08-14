import { helloProject } from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import {
  readSessionLine,
  redactSecret,
  renderDevelopmentSession,
  SESSION_ENTRY_NAME,
  SESSION_RUNTIME_NAME
} from "./development-session.js"

/**
 * The Session, on both sides of the pipe: the entry point the sidecar runs, and
 * the reading of what it writes back.
 *
 * These are the fast tests. That the entry point actually starts a bot is
 * proven by spawning a real Node.js on it in `run-development-session.test.ts`.
 */

const TOKEN = "not-a-real-token.aaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb"

describe("the entry point a Session runs", () => {
  it("takes its Runtime from the file placed beside it, not from a package", () => {
    const source = renderDevelopmentSession(helloProject(), {})

    expect(source).toContain(`from "./${SESSION_RUNTIME_NAME}"`)
    expect(source).not.toContain("@bot-inventor/runtime")
  })

  it("reads the token from the environment rather than carrying one", () => {
    // Rendering takes no token to begin with, so there is none to leak: the
    // token reaches the bot on the child process's environment and nowhere
    // else, which is what keeps it out of the file and out of the panel.
    const source = renderDevelopmentSession(helloProject(), {})

    expect(source).toContain("process.env.DISCORD_TOKEN")
    expect(source).not.toContain(TOKEN)
  })

  it("registers the Project's commands to the chosen test server", () => {
    const source = renderDevelopmentSession(helloProject(), { testServerId: "700000000000000007" })

    expect(source).toContain('guildId: "700000000000000007"')
  })

  it("registers globally when no test server was chosen", () => {
    expect(renderDevelopmentSession(helloProject(), {})).not.toContain("guildId:")
  })

  it("carries the Tracing the Canvas needs, unlike a Build", () => {
    const source = renderDevelopmentSession(helloProject(), {})

    expect(source).toContain("node-entered")
    // Emitting Tracing and never sending it would light nothing up.
    expect(source).toContain('onTrace: event => send({ kind: "trace", event })')
  })

  it("emits nothing but the Session's own messages when a Project has no Trigger", () => {
    // A Project nobody has wired up yet still has to start, so that the user
    // sees a bot that is ready and answers nothing rather than one that failed.
    const source = renderDevelopmentSession({ ...helloProject(), flows: [] }, { testServerId: "1" })

    expect(source).toContain("await runtime.start()")
  })
})

describe("reading a line the Session wrote", () => {
  it("recognises a message the Session sent on purpose", () => {
    expect(readSessionLine('@botinv {"kind":"status","status":"ready"}')).toEqual({
      kind: "status",
      status: "ready"
    })
  })

  it("recognises a Tracing event, which is what the Canvas lights up from", () => {
    expect(
      readSessionLine(
        '@botinv {"kind":"trace","event":{"kind":"wire-carried","run":1,"flow":"flow-greet","wire":"wire-data","value":"<@42>"}}'
      )
    ).toEqual({
      kind: "trace",
      event: {
        kind: "wire-carried",
        run: 1,
        flow: "flow-greet",
        wire: "wire-data",
        value: "<@42>"
      }
    })
  })

  it("drops a Tracing event that is not shaped the way the Canvas reads it", () => {
    expect(
      readSessionLine('@botinv {"kind":"trace","event":{"kind":"node-entered"}}')
    ).toBeUndefined()
  })

  it("treats anything else as output for the panel", () => {
    expect(readSessionLine("The bot is running.")).toEqual({
      kind: "output",
      text: "The bot is running."
    })
  })

  it("treats a broken message as output rather than losing it", () => {
    // The bot's own code can print anything, including our prefix. A line we
    // cannot read is still something the user should see.
    expect(readSessionLine("@botinv {not json")).toEqual({
      kind: "output",
      text: "@botinv {not json"
    })
  })

  it("keeps a message it does not understand out of the panel", () => {
    // An older build reading a newer Session must not spill protocol at the
    // user; it drops the message instead.
    expect(readSessionLine('@botinv {"kind":"invented-later"}')).toBeUndefined()
  })
})

describe("redacting a Secret from what the panel shows", () => {
  it("hides the token wherever it appears in a line", () => {
    expect(redactSecret(`login failed for ${TOKEN}, retrying`, TOKEN)).toBe(
      "login failed for [redacted], retrying"
    )
  })

  it("hides every occurrence, not just the first", () => {
    expect(redactSecret(`${TOKEN} and ${TOKEN}`, TOKEN)).toBe("[redacted] and [redacted]")
  })

  it("hides the token inside a Tracing event before anything reads it", () => {
    // A Wire cannot carry the token today, but redaction is applied to the
    // whole line rather than to the panel's share of it, so that no message
    // kind added later becomes a way around it.
    const line = `@botinv {"kind":"trace","event":{"kind":"wire-carried","run":1,"flow":"f","wire":"w","value":"${TOKEN}"}}`
    const message = readSessionLine(redactSecret(line, TOKEN))

    expect(message).toMatchObject({ kind: "trace", event: { value: "[redacted]" } })
  })

  it("leaves the line alone when there is no Secret to hide", () => {
    expect(redactSecret("nothing secret here", "")).toBe("nothing secret here")
    expect(redactSecret("nothing secret here", undefined)).toBe("nothing secret here")
  })
})

describe("the names a Session's files have", () => {
  it("keeps the entry point and the Runtime apart", () => {
    expect(SESSION_ENTRY_NAME).not.toBe(SESSION_RUNTIME_NAME)
  })
})
