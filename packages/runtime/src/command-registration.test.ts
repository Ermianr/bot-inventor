import { describe, expect, it } from "vitest"

import { type RegistrationTarget, registerCommands } from "./command-registration.js"
import type { SlashCommandDefinition } from "./discord.js"
import { createFakeDiscordCommandApi } from "./testing.js"

const testServer: RegistrationTarget = { kind: "guild", guildId: "guild-1" }
const everywhere: RegistrationTarget = { kind: "global" }

const hello: SlashCommandDefinition = { name: "hello", description: "Says hello" }
const goodbye: SlashCommandDefinition = { name: "goodbye", description: "Says goodbye" }

describe("command registration", () => {
  it("registers a Project's commands to a test server", async () => {
    const api = createFakeDiscordCommandApi()

    const result = await registerCommands(api, testServer, [hello, goodbye])

    expect(result.registered).toEqual(["hello", "goodbye"])
    expect(api.commandsFor(testServer).map(command => command.name)).toEqual(["hello", "goodbye"])
  })

  it("registers a Project's commands globally", async () => {
    const api = createFakeDiscordCommandApi()

    await registerCommands(api, everywhere, [hello])

    expect(api.commandsFor(everywhere).map(command => command.name)).toEqual(["hello"])
  })

  it("leaves the other target untouched", async () => {
    const api = createFakeDiscordCommandApi()

    await registerCommands(api, testServer, [hello])

    expect(api.commandsFor(everywhere)).toEqual([])
  })

  it("drives both targets through the same requests", async () => {
    const api = createFakeDiscordCommandApi()

    await registerCommands(api, testServer, [hello])
    await registerCommands(api, everywhere, [hello])

    expect(api.requests).toEqual([
      { method: "list", target: testServer },
      { method: "put", target: testServer },
      { method: "list", target: everywhere },
      { method: "put", target: everywhere }
    ])
  })

  it("deletes a command Discord holds that the Project no longer declares", async () => {
    const api = createFakeDiscordCommandApi()
    api.seed(testServer, [{ name: "obsolete", description: "Left over", options: [] }])

    const result = await registerCommands(api, testServer, [hello])

    expect(result.deleted).toEqual(["obsolete"])
    expect(api.commandsFor(testServer).map(command => command.name)).toEqual(["hello"])
  })

  it("does not leave a renamed command registered under its previous name", async () => {
    const api = createFakeDiscordCommandApi()
    await registerCommands(api, testServer, [hello])

    const result = await registerCommands(api, testServer, [{ ...hello, name: "greet" }, goodbye])

    expect(result.deleted).toEqual(["hello"])
    expect(api.commandsFor(testServer).map(command => command.name)).toEqual(["greet", "goodbye"])
  })

  it("reports nothing deleted when the Project is unchanged", async () => {
    const api = createFakeDiscordCommandApi()
    await registerCommands(api, everywhere, [hello, goodbye])

    const result = await registerCommands(api, everywhere, [hello, goodbye])

    expect(result.deleted).toEqual([])
  })

  it("takes name, description and parameters from the declaration", async () => {
    const api = createFakeDiscordCommandApi()

    await registerCommands(api, everywhere, [
      {
        name: "greet",
        description: "Greets someone",
        parameters: [
          { name: "who", description: "Who to greet", type: "user", required: true },
          { name: "times", description: "How many times", type: "number", required: false }
        ]
      }
    ])

    expect(api.commandsFor(everywhere)).toEqual([
      {
        name: "greet",
        description: "Greets someone",
        options: [
          { type: 6, name: "who", description: "Who to greet", required: true },
          { type: 10, name: "times", description: "How many times", required: false }
        ]
      }
    ])
  })

  it("asks for the required parameters first, whatever order they were declared in", async () => {
    const api = createFakeDiscordCommandApi()

    await registerCommands(api, everywhere, [
      {
        name: "greet",
        description: "Greets someone",
        parameters: [
          { name: "times", description: "How many times", type: "number", required: false },
          { name: "who", description: "Who to greet", type: "user", required: true },
          { name: "loudly", description: "Shout it", type: "boolean", required: false }
        ]
      }
    ])

    expect(api.commandsFor(everywhere)[0]?.options.map(option => option.name)).toEqual([
      "who",
      "times",
      "loudly"
    ])
  })

  it("names the parameter whose type this build cannot ask for", async () => {
    const api = createFakeDiscordCommandApi()
    const declaration = {
      name: "greet",
      description: "Greets someone",
      parameters: [{ name: "where", description: "A channel", type: "channel", required: true }]
    } as unknown as SlashCommandDefinition

    await expect(registerCommands(api, everywhere, [declaration])).rejects.toThrowError(
      /"where".+"greet".+"channel"/s
    )
    expect(api.commandsFor(everywhere)).toEqual([])
  })

  it("names the parameter Discord would refuse the whole registration over", async () => {
    const api = createFakeDiscordCommandApi()
    const declaration: SlashCommandDefinition = {
      name: "greet",
      description: "Greets someone",
      parameters: [{ name: "How many", description: "A count", type: "number", required: true }]
    }

    // Discord answers this with a form error about `options[0].name` and
    // registers nothing at all, so the whole bot fails to come up over one
    // capital letter. Saying which parameter it is beats that.
    await expect(registerCommands(api, everywhere, [declaration])).rejects.toThrowError(
      /"greet".+"How many".+lowercase/s
    )
    expect(api.commandsFor(everywhere)).toEqual([])
  })

  it("names the parameter that was asked for twice", async () => {
    const api = createFakeDiscordCommandApi()
    const declaration: SlashCommandDefinition = {
      name: "greet",
      description: "Greets someone",
      parameters: [
        { name: "who", description: "Who to greet", type: "user", required: true },
        { name: "who", description: "And again", type: "text", required: true }
      ]
    }

    await expect(registerCommands(api, everywhere, [declaration])).rejects.toThrowError(
      /"greet".+"who".+twice/s
    )
  })

  it("still registers when Discord will not say what it already holds", async () => {
    const api = createFakeDiscordCommandApi()
    api.listCommands = async () => {
      throw new Error("Discord is rate limiting us")
    }

    const result = await registerCommands(api, everywhere, [hello])

    expect(result.deleted).toEqual([])
    expect(api.commandsFor(everywhere).map(command => command.name)).toEqual(["hello"])
  })

  it("registers a command declaring no parameters with no options", async () => {
    const api = createFakeDiscordCommandApi()

    await registerCommands(api, everywhere, [hello])

    expect(api.commandsFor(everywhere)).toEqual([
      { name: "hello", description: "Says hello", options: [] }
    ])
  })

  it("removes every command when the Project declares none", async () => {
    const api = createFakeDiscordCommandApi()
    await registerCommands(api, testServer, [hello, goodbye])

    const result = await registerCommands(api, testServer, [])

    expect(result.deleted).toEqual(["hello", "goodbye"])
    expect(api.commandsFor(testServer)).toEqual([])
  })
})
