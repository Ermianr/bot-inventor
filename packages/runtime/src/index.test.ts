import { describe, expect, it, vi } from "vitest"
import { coercions } from "./coercions.js"
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
})
