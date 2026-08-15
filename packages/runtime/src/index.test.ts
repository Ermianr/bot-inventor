import { describe, expect, it, vi } from "vitest"
import { coercions } from "./coercions.js"
import type { SlashCommandEvent } from "./discord.js"
import { createFakeRuntime } from "./testing.js"

describe("the fake Runtime", () => {
  it("records the slash commands a bot declares and runs them on demand", async () => {
    const runtime = createFakeRuntime()
    const handler = vi.fn(async () => {})

    runtime.discord.registerSlashCommand({ name: "hello", description: "Says hello" }, handler)
    await runtime.dispatchSlashCommand({ command: "hello", user: { displayName: "Ada" } })

    expect(runtime.commands).toEqual(["hello"])
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: "hello",
        user: expect.objectContaining({ displayName: "Ada" })
      })
    )
  })

  it("records replies rather than sending them", async () => {
    const runtime = createFakeRuntime()
    runtime.discord.registerSlashCommand({ name: "hello", description: "" }, async event => {
      await runtime.discord.reply(event, { content: "Hello!", ephemeral: true })
    })

    await runtime.dispatchSlashCommand({ command: "hello" })

    expect(runtime.calls).toContainEqual({
      method: "reply",
      commandName: "hello",
      content: "Hello!",
      ephemeral: true
    })
  })

  it("can be told to make a reply fail", async () => {
    const runtime = createFakeRuntime({ replyFails: () => "the channel is gone" })
    runtime.discord.registerSlashCommand({ name: "hello", description: "" }, async event => {
      await runtime.discord.reply(event, { content: "Hello!", ephemeral: false })
    })

    await expect(runtime.dispatchSlashCommand({ command: "hello" })).rejects.toThrowError(
      "the channel is gone"
    )
  })

  it("hands a Flow the values the caller supplied, keyed by parameter name", async () => {
    const runtime = createFakeRuntime()
    const events: SlashCommandEvent[] = []
    runtime.discord.registerSlashCommand({ name: "echo", description: "" }, async event => {
      events.push(event)
    })

    await runtime.dispatchSlashCommand({
      command: "echo",
      parameters: { message: "Good morning", times: 2, loudly: true }
    })

    expect(events[0]?.parameters).toEqual({ message: "Good morning", times: 2, loudly: true })
  })

  it("tells a parameter the caller left out from one they answered with nothing", async () => {
    const runtime = createFakeRuntime()
    const events: SlashCommandEvent[] = []
    runtime.discord.registerSlashCommand({ name: "echo", description: "" }, async event => {
      events.push(event)
    })

    await runtime.dispatchSlashCommand({ command: "echo", parameters: { message: "" } })
    await runtime.dispatchSlashCommand({ command: "echo" })

    // Empty text was typed; absent was not, and a Flow has to be able to see
    // the difference between the two.
    expect(events[0]?.parameters).toEqual({ message: "" })
    expect(events[1]?.parameters).toEqual({})
    expect(events[0] !== undefined && "message" in events[0].parameters).toBe(true)
    expect(events[1] !== undefined && "message" in events[1].parameters).toBe(false)
  })

  it("refuses a command no Flow is registered for", async () => {
    const runtime = createFakeRuntime()

    await expect(runtime.dispatchSlashCommand({ command: "hello" })).rejects.toThrowError(
      /no Flow is registered/
    )
  })

  it("refuses the same slash command twice", () => {
    const runtime = createFakeRuntime()
    runtime.discord.registerSlashCommand({ name: "hello", description: "" }, async () => {})

    expect(() =>
      runtime.discord.registerSlashCommand({ name: "hello", description: "" }, async () => {})
    ).toThrowError(/registered twice/)
  })
})

describe("Coercions", () => {
  it("renders a user as a Discord mention", () => {
    expect(coercions.userToText({ id: "1", username: "ada", displayName: "Ada L." })).toBe("<@1>")
  })

  it("renders no user as nothing, rather than as a mention of nobody", () => {
    expect(coercions.userToText(null)).toBe("")
  })

  it("renders a number the way the reader would write it", () => {
    expect(coercions.numberToText(2)).toBe("2")
    expect(coercions.numberToText(1.5)).toBe("1.5")
  })

  it("renders a boolean as text", () => {
    expect(coercions.booleanToText(true)).toBe("true")
    expect(coercions.booleanToText(false)).toBe("false")
  })
})
