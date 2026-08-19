import {
  buildCatalogue,
  type DataType,
  type NodeDefinition,
  reply,
  slashCommandTrigger
} from "@bot-inventor/nodes"
import {
  registerCommands,
  type SlashCommandDefinition,
  toDiscordEmbed
} from "@bot-inventor/runtime"
import { createFakeDiscordCommandApi, type RecordedCall } from "@bot-inventor/runtime/testing"
import { literalText, type Project, type SlottedText } from "@bot-inventor/schema"
import {
  echoParameterProject,
  embedReplyProject,
  emptyProject,
  greetingProject,
  helloProject,
  parameterisedCommandProject,
  requireFirst,
  slottedGreetingProject,
  unreachableNodeProject
} from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import { compile } from "./compile.js"
import { CompilerError } from "./errors.js"
import { type RunProjectResult, runProject } from "./testing.js"

/** The replies the bot sent, which is what these tests are actually about. */
function replies(result: RunProjectResult): string[] {
  return result.calls
    .filter((call): call is Extract<RecordedCall, { method: "reply" }> => call.method === "reply")
    .map(call => call.content)
}

/** What the compiled Project declared to the Runtime, ready to be registered. */
function declarations(result: RunProjectResult): SlashCommandDefinition[] {
  return result.calls
    .filter(
      (call): call is Extract<RecordedCall, { method: "registerSlashCommand" }> =>
        call.method === "registerSlashCommand"
    )
    .map(call => call.definition)
}

/** A Node whose Data Port carries a different type, for testing an illegal Wire. */
function withDataType(
  definition: NodeDefinition,
  portId: string,
  dataType: DataType
): NodeDefinition {
  return {
    ...definition,
    ports: definition.ports.map(port =>
      port.id === portId && port.kind === "data" ? { ...port, dataType } : port
    )
  }
}

/** A Node demanding a User, which the catalogue has none of yet. */
const userSink: NodeDefinition = {
  id: "test.userSink",
  labelKey: "test.userSink.label",
  descriptionKey: "test.userSink.description",
  isTrigger: false,
  ports: [
    { id: "in", kind: "execution", direction: "input", labelKey: "ports.in.label" },
    {
      id: "who",
      kind: "data",
      direction: "input",
      dataType: "user",
      labelKey: "test.userSink.ports.who.label"
    }
  ],
  fields: [],
  generate: context => `void ${context.input("who")}`
}

/** A slash command Trigger whose caller is carried into a Node demanding a User. */
function userSinkProject(): Project {
  const project = helloProject()
  const flow = requireFirst(project.flows, "Flow")
  flow.nodes = [
    requireFirst(flow.nodes, "Node"),
    { id: "node-sink", type: "test.userSink", position: { x: 320, y: 0 }, fields: {} }
  ]
  flow.wires = [
    {
      id: "wire-execution",
      kind: "execution",
      from: { node: "node-trigger", port: "next" },
      to: { node: "node-sink", port: "in" }
    },
    {
      id: "wire-data",
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-sink", port: "who" }
    }
  ]
  return project
}

/** `helloProject` with a second Reply wired after the first. */
function twoRepliesProject(): Project {
  const project = helloProject()
  const flow = requireFirst(project.flows, "Flow")
  flow.nodes.push({
    id: "node-second",
    type: "discord.interaction.reply",
    position: { x: 640, y: 0 },
    fields: { content: literalText("And again"), ephemeral: false }
  })
  flow.wires.push({
    id: "wire-second",
    kind: "execution",
    from: { node: "node-reply", port: "next" },
    to: { node: "node-second", port: "in" }
  })
  return project
}

/** The Embed one reply carried, for a test that asserts on part of it. */
function embedOf(result: RunProjectResult) {
  const call = result.calls.find(candidate => candidate.method === "reply")
  if (call === undefined) throw new Error("the run made no reply")
  return call.embed
}

describe("running a compiled Project", () => {
  it("answers /hello with the text typed into the Reply Node", async () => {
    const result = await runProject(helloProject(), [{ type: "slashCommand", command: "hello" }])

    expect(result.commands).toEqual(["hello"])
    expect(replies(result)).toEqual(["Hello!"])
    expect(result.failures).toEqual([])
  })

  it("declares the slash command the Trigger describes", async () => {
    const result = await runProject(helloProject(), [])

    expect(result.calls).toEqual([
      {
        method: "registerSlashCommand",
        definition: { name: "hello", description: "Says hello" }
      }
    ])
  })

  it("greets the caller by mentioning them, coercing the User into text", async () => {
    const result = await runProject(greetingProject(), [
      { type: "slashCommand", command: "greet", user: { id: "42", displayName: "Ada" } }
    ])

    expect(replies(result)).toEqual(["<@42>"])
  })

  it("answers with what the caller typed into the command's parameter", async () => {
    const result = await runProject(echoParameterProject(), [
      { type: "slashCommand", command: "echo", parameters: { message: "Good morning" } }
    ])

    expect(replies(result)).toEqual(["Good morning"])
    expect(result.failures).toEqual([])
  })

  it("leaves out Nodes that are not reachable from the Trigger", async () => {
    const result = await runProject(unreachableNodeProject(), [
      { type: "slashCommand", command: "hello" }
    ])

    expect(replies(result)).toEqual(["Hello!"])
  })

  it("stops the run at a failing action and reports it", async () => {
    const result = await runProject(
      twoRepliesProject(),
      [{ type: "slashCommand", command: "hello" }],
      {
        replyFails: (_event, options) =>
          options.content === "Hello!" ? "the bot cannot write in this channel" : undefined
      }
    )

    expect(replies(result)).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ flow: "flow-hello", node: "node-reply" })
    expect(result.failures[0]?.error).toBeInstanceOf(Error)
  })

  it("keeps running the Flow when nothing fails", async () => {
    const result = await runProject(twoRepliesProject(), [
      { type: "slashCommand", command: "hello" }
    ])

    expect(replies(result)).toEqual(["Hello!", "And again"])
  })

  it("produces the same Discord calls in Development Mode as in Build", async () => {
    const events = [{ type: "slashCommand", command: "hello" }] as const
    const build = await runProject(helloProject(), events, { mode: "build" })
    const development = await runProject(helloProject(), events, { mode: "development" })

    expect(development.calls).toEqual(build.calls)
    expect(build.traces).toEqual([])
    expect(development.traces).toContainEqual({
      kind: "node-entered",
      run: 1,
      flow: "flow-hello",
      node: "node-reply"
    })
  })

  it("compiles a Project with no Nodes to a bot that does nothing", async () => {
    const result = await runProject(emptyProject(), [])

    expect(result.calls).toEqual([])
    expect(result.commands).toEqual([])
  })
})

/** The Embed Node of a fixture, for a test that types more into it. */
function embedNode(project: Project) {
  const flow = requireFirst(project.flows, "Flow")
  const node = flow.nodes.find(candidate => candidate.type === "discord.embed.build")
  if (node === undefined) throw new Error("the fixture has no Embed Node")
  return node
}

describe("answering with an Embed", () => {
  const useCard = [{ type: "slashCommand", command: "card" }] as const

  it("reaches Discord with its title, its text and its colour", async () => {
    const result = await runProject(embedReplyProject(), useCard)

    expect(result.failures).toEqual([])
    expect(result.calls.filter(call => call.method === "reply")).toEqual([
      {
        method: "reply",
        commandName: "card",
        content: "",
        ephemeral: false,
        embed: {
          title: "Server rules",
          description: "Be kind to one another.",
          colour: 5793266
        }
      }
    ])
  })

  it("normalises the colour a hand-edited Project holds", async () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = { ...node.fields, colour: 0xffffff + 1 }

    const result = await runProject(project, useCard)

    expect(embedOf(result)).toMatchObject({ colour: 0xffffff })
  })

  it("puts a value from a Wire inside the Embed's text, through its Slot", async () => {
    const project = embedReplyProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      description: [
        { kind: "literal", text: "Asked for by " },
        { kind: "slot", slot: "slot-caller" }
      ]
    }
    flow.wires.push({
      id: "wire-caller",
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-embed", port: "slot.slot-caller" }
    })

    const result = await runProject(project, [
      { type: "slashCommand", command: "card", user: { id: "42" } }
    ])

    expect(embedOf(result)).toMatchObject({ description: "Asked for by <@42>" })
  })

  it("carries every part of the Embed to Discord", async () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      url: literalText("https://example.com/rules"),
      authorName: literalText("The moderators"),
      authorUrl: literalText("https://example.com/team"),
      authorIcon: literalText("https://example.com/team.png"),
      image: literalText("https://example.com/banner.png"),
      thumbnail: literalText("https://example.com/badge.png"),
      footerText: literalText("Asked once a month"),
      footerIcon: literalText("https://example.com/clock.png")
    }

    const result = await runProject(project, useCard)

    expect(result.failures).toEqual([])
    expect(embedOf(result)).toEqual({
      title: "Server rules",
      url: "https://example.com/rules",
      description: "Be kind to one another.",
      colour: 5793266,
      author: {
        name: "The moderators",
        url: "https://example.com/team",
        icon: "https://example.com/team.png"
      },
      image: "https://example.com/banner.png",
      thumbnail: "https://example.com/badge.png",
      footer: { text: "Asked once a month", icon: "https://example.com/clock.png" }
    })
  })

  it("carries the Embed Fields in the order they were written, inline honoured", async () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      embedFields: [
        { name: literalText("Rule 1"), value: literalText("Be kind"), inline: true },
        { name: literalText("Rule 2"), value: literalText("Be brief"), inline: false }
      ]
    }

    const result = await runProject(project, useCard)

    expect(result.failures).toEqual([])
    expect(embedOf(result)?.embedFields).toEqual([
      { name: "Rule 1", value: "Be kind", inline: true },
      { name: "Rule 2", value: "Be brief", inline: false }
    ])
  })

  it("puts a value from a Wire inside an Embed Field, through its Slot", async () => {
    const project = embedReplyProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      embedFields: [
        {
          name: literalText("Asked by"),
          value: [{ kind: "slot", slot: "slot-caller" }],
          inline: false
        }
      ]
    }
    flow.wires.push({
      id: "wire-caller",
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-embed", port: "slot.slot-caller" }
    })

    const result = await runProject(project, [
      { type: "slashCommand", command: "card", user: { id: "42" } }
    ])

    expect(result.failures).toEqual([])
    expect(embedOf(result)?.embedFields).toEqual([
      { name: "Asked by", value: "<@42>", inline: false }
    ])
  })

  it("refuses an Embed Field whose name does not read as text with Slots in it", () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      embedFields: [{ name: "Rule 1", value: literalText("Be kind"), inline: false }]
    }

    expect(() => compile(project, { mode: "build" })).toThrowError(/does not read as text/)
  })

  it("hands every part to Discord under the name its API knows it by", async () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      authorName: literalText("The moderators"),
      authorIcon: literalText("https://example.com/team.png"),
      image: literalText("https://example.com/banner.png"),
      thumbnail: literalText("https://example.com/badge.png"),
      footerText: literalText("Asked once a month")
    }

    const result = await runProject(project, useCard)
    const built = embedOf(result)
    if (built === undefined) throw new Error("the reply carried no Embed")

    // The run stops at the Runtime's own Embed, so the last step to Discord is
    // taken here: a rename lost at that boundary is an Embed that never draws.
    expect(toDiscordEmbed(built)).toMatchObject({
      color: 5793266,
      author: { name: "The moderators", icon_url: "https://example.com/team.png" },
      image: { url: "https://example.com/banner.png" },
      thumbnail: { url: "https://example.com/badge.png" },
      footer: { text: "Asked once a month" }
    })
  })

  it("stamps the Embed with the time it was sent when the switch is on", async () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = { ...node.fields, timestamp: true }
    const before = Date.now()

    const result = await runProject(project, useCard)
    const stamped = embedOf(result)?.timestamp

    expect(stamped).toBeDefined()
    expect(Date.parse(stamped ?? "")).toBeGreaterThanOrEqual(before)
  })

  it("stamps nothing when the switch is off, which is how an Embed starts", async () => {
    const result = await runProject(embedReplyProject(), useCard)

    expect(embedOf(result)?.timestamp).toBeUndefined()
  })

  it("puts a value from a Wire inside the footer, as it does inside the text", async () => {
    const project = embedReplyProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      footerText: [
        { kind: "literal", text: "Asked for by " },
        { kind: "slot", slot: "slot-caller" }
      ]
    }
    flow.wires.push({
      id: "wire-caller",
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-embed", port: "slot.slot-caller" }
    })

    const result = await runProject(project, [
      { type: "slashCommand", command: "card", user: { id: "42" } }
    ])

    expect(embedOf(result)?.footer).toEqual({ text: "Asked for by <@42>" })
  })

  it("keeps the ephemeral switch, so a rich reply can be private too", async () => {
    const project = embedReplyProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = flow.nodes.find(candidate => candidate.id === "node-reply")
    if (node === undefined) throw new Error("the fixture has no Reply Node")
    node.fields = { ...node.fields, ephemeral: true }

    const result = await runProject(project, useCard)

    expect(result.calls).toContainEqual(
      expect.objectContaining({ method: "reply", ephemeral: true })
    )
  })

  it("answers with plain text and no Embed when none is wired", async () => {
    const result = await runProject(helloProject(), [{ type: "slashCommand", command: "hello" }])

    expect(result.calls).toContainEqual(
      expect.objectContaining({ method: "reply", content: "Hello!", embed: undefined })
    )
  })

  it("lights the Embed Node up in Development Mode like every other Node", async () => {
    const result = await runProject(embedReplyProject(), useCard, { mode: "development" })

    expect(result.traces).toContainEqual({
      kind: "node-entered",
      run: 1,
      flow: "flow-card",
      node: "node-embed"
    })
    expect(result.traces).toContainEqual({
      kind: "node-completed",
      run: 1,
      flow: "flow-card",
      node: "node-embed"
    })
  })

  it("says on the Wire what the Embed carried", async () => {
    const result = await runProject(embedReplyProject(), useCard, { mode: "development" })

    expect(
      result.traces.find(event => event.kind === "wire-carried" && event.wire === "wire-embed")
    ).toMatchObject({ value: expect.stringContaining("Server rules") })
  })

  it("produces the same Discord calls in Development Mode as in Build", async () => {
    const build = await runProject(embedReplyProject(), useCard, { mode: "build" })
    const development = await runProject(embedReplyProject(), useCard, { mode: "development" })

    expect(development.calls).toEqual(build.calls)
  })
})

describe("watching a run in Development Mode", () => {
  const useGreet = [
    { type: "slashCommand", command: "greet", user: { id: "42", displayName: "Ana" } }
  ] as const

  it("reports every Node it entered and completed, in the order it ran them", async () => {
    const result = await runProject(greetingProject(), useGreet, { mode: "development" })

    expect(
      result.traces.map(trace => `${trace.kind} ${"node" in trace ? trace.node : ""}`)
    ).toEqual([
      "node-entered node-trigger",
      "node-completed node-trigger",
      "node-entered node-reply",
      "wire-carried ",
      "node-completed node-reply"
    ])
  })

  it("reports what a Wire carried, as it arrived at the far end of it", async () => {
    const result = await runProject(greetingProject(), useGreet, { mode: "development" })

    // The Wire converts the User into text on its way into the Reply, and the
    // mention is what the Reply was actually given.
    expect(result.traces).toContainEqual({
      kind: "wire-carried",
      run: 1,
      flow: "flow-greet",
      wire: "wire-data",
      value: "<@42>"
    })
  })

  it("gives each run its own number, so two of them can be told apart", async () => {
    const result = await runProject(greetingProject(), [...useGreet, ...useGreet], {
      mode: "development"
    })

    expect([...new Set(result.traces.map(trace => trace.run))]).toEqual([1, 2])
  })

  it("says which run failed, so the Canvas marks the one being watched", async () => {
    const result = await runProject(greetingProject(), useGreet, {
      mode: "development",
      replyFails: () => "the bot cannot write in this channel"
    })

    expect(result.failures[0]).toMatchObject({ run: 1, flow: "flow-greet", node: "node-reply" })
  })

  it("adds nothing at all to a Build", () => {
    const build = compile(greetingProject(), { mode: "build" })

    expect(build.source).not.toContain("trace")
    expect(build.source).not.toContain("startRun")
    expect(build.source).not.toContain("run:")
  })
})

describe("reading a slash command's parameters", () => {
  /**
   * `echoParameterProject` asking for one parameter of the given declaration
   * instead, with the Reply reading whichever Port it produced.
   */
  function echoOf(parameter: { name: string; type: string; required: boolean }): Project {
    const project = echoParameterProject()
    const flow = requireFirst(project.flows, "Flow")
    const trigger = requireFirst(flow.nodes, "Node")
    trigger.fields.parameters = [{ description: "What to say", ...parameter }]

    const wire = flow.wires.find(candidate => candidate.id === "wire-data")
    if (wire === undefined) throw new Error("the fixture has no Data Wire")
    wire.from.port = `parameter.${parameter.name}`
    return project
  }

  it("declares the parameters the caller is asked for alongside the command", async () => {
    const result = await runProject(echoParameterProject(), [])

    expect(declarations(result)).toEqual([
      {
        name: "echo",
        description: "Says something back",
        parameters: [{ name: "message", description: "What to say", type: "text", required: true }]
      }
    ])
  })

  it("coerces a Number the caller supplied into the text of the reply", async () => {
    const result = await runProject(echoOf({ name: "times", type: "number", required: true }), [
      { type: "slashCommand", command: "echo", parameters: { times: 1.5 } }
    ])

    expect(replies(result)).toEqual(["1.5"])
  })

  it("coerces a Boolean the caller supplied into the text of the reply", async () => {
    const result = await runProject(echoOf({ name: "loudly", type: "boolean", required: true }), [
      { type: "slashCommand", command: "echo", parameters: { loudly: false } }
    ])

    expect(replies(result)).toEqual(["false"])
  })

  it("mentions the user the caller named, through the same Coercion the caller goes through", async () => {
    const result = await runProject(echoOf({ name: "who", type: "user", required: true }), [
      {
        type: "slashCommand",
        command: "echo",
        parameters: { who: { id: "42", username: "ada", displayName: "Ada" } }
      }
    ])

    expect(replies(result)).toEqual(["<@42>"])
  })

  it("says nothing, rather than 'undefined', for an optional parameter nobody answered", async () => {
    const optional = { name: "message", type: "text", required: false } as const
    const project = echoOf(optional)

    const answered = await runProject(project, [
      { type: "slashCommand", command: "echo", parameters: { message: "" } }
    ])
    const unanswered = await runProject(project, [{ type: "slashCommand", command: "echo" }])

    expect(replies(answered)).toEqual([""])
    expect(replies(unanswered)).toEqual([""])
    expect(unanswered.failures).toEqual([])
  })

  it("leaves an unanswered optional Number and User empty rather than undefined", async () => {
    const times = await runProject(echoOf({ name: "times", type: "number", required: false }), [
      { type: "slashCommand", command: "echo" }
    ])
    const who = await runProject(echoOf({ name: "who", type: "user", required: false }), [
      { type: "slashCommand", command: "echo" }
    ])

    expect(replies(times)).toEqual(["0"])
    expect(replies(who)).toEqual([""])
  })

  it("gives two parameters whose names are not identifiers two values of their own", async () => {
    const project = echoParameterProject()
    const flow = requireFirst(project.flows, "Flow")
    const trigger = requireFirst(flow.nodes, "Node")
    trigger.fields.parameters = [
      { name: "say-it", description: "What to say", type: "text", required: true },
      { name: "say_it", description: "And again", type: "text", required: true }
    ]
    const wire = flow.wires.find(candidate => candidate.id === "wire-data")
    if (wire === undefined) throw new Error("the fixture has no Data Wire")
    wire.from.port = "parameter.say-it"

    const result = await runProject(project, [
      {
        type: "slashCommand",
        command: "echo",
        parameters: { "say-it": "first", say_it: "second" }
      }
    ])

    expect(replies(result)).toEqual(["first"])
  })

  it("refuses a Project whose Wire reads a parameter that is no longer declared", () => {
    const project = echoParameterProject()
    const trigger = requireFirst(requireFirst(project.flows, "Flow").nodes, "Node")
    trigger.fields.parameters = []

    // Silently emitting the Reply's own empty field instead would be a bot
    // answering with nothing and no way for the user to find out why.
    expect(() => compile(project, { mode: "build" })).toThrowError(/no longer exists/)
  })

  it("blames the Node the parameter went from, not the one that was reading it", () => {
    const project = echoParameterProject()
    const trigger = requireFirst(requireFirst(project.flows, "Flow").nodes, "Node")
    trigger.fields.parameters = []

    try {
      compile(project, { mode: "build" })
      throw new Error("the Compiler accepted a Wire to a Port that is not there")
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerError)
      expect(error).toMatchObject({ node: "node-trigger" })
    }
  })

  it("hands a parameter this build cannot make a Port of to registration, which names it", async () => {
    const project = echoParameterProject()
    const flow = requireFirst(project.flows, "Flow")
    const trigger = requireFirst(flow.nodes, "Node")
    trigger.fields.parameters = [
      { name: "where", description: "A channel", type: "channel", required: true }
    ]
    // The Wire read the parameter that is now gone; the case here is the
    // declaration, not the Wire.
    flow.wires = flow.wires.filter(wire => wire.id !== "wire-data")

    // Dropping it here instead would register a command quietly asking for
    // less than the Canvas says it does.
    const result = await runProject(project, [])
    expect(declarations(result)[0]?.parameters).toEqual([
      { name: "where", description: "A channel", type: "channel", required: true }
    ])
    await expect(
      registerCommands(createFakeDiscordCommandApi(), { kind: "global" }, declarations(result))
    ).rejects.toThrowError(/"where"/)
  })
})

describe("putting a value inside a Node's text", () => {
  /**
   * `echoParameterProject` — a `/echo` whose reply is one Slot fed by a
   * parameter — with the message written around that Slot instead.
   */
  function messageOf(...segments: SlottedText): Project {
    const project = echoParameterProject()
    const flow = requireFirst(project.flows, "Flow")
    const reply = flow.nodes[1]
    if (reply === undefined) throw new Error("the fixture has no Reply Node")
    reply.fields.content = segments
    return project
  }

  const message = { kind: "slot", slot: "slot-message" } as const

  it("answers with the literal text around the Slot, and the Slot filled in", async () => {
    const project = messageOf({ kind: "literal", text: "Hello " }, message)

    const result = await runProject(project, [
      { type: "slashCommand", command: "echo", parameters: { message: "Kevin" } }
    ])

    expect(replies(result)).toEqual(["Hello Kevin"])
  })

  it("fills the same Slot in wherever it appears, from the one Wire feeding it", async () => {
    const project = messageOf(message, { kind: "literal", text: " and again " }, message)

    const result = await runProject(project, [
      { type: "slashCommand", command: "echo", parameters: { message: "Kevin" } }
    ])

    expect(replies(result)).toEqual(["Kevin and again Kevin"])
  })

  it("answers with the text as typed when the message holds no Slot at all", async () => {
    const project = messageOf({ kind: "literal", text: "Hello everyone" })
    // Taking the last occurrence of a Slot away takes its Port with it, and the
    // Wire drawn to it is the editor's to remove as part of that same edit.
    const flow = requireFirst(project.flows, "Flow")
    flow.wires = flow.wires.filter(wire => wire.id !== "wire-data")

    const result = await runProject(project, [
      { type: "slashCommand", command: "echo", parameters: { message: "Kevin" } }
    ])

    expect(replies(result)).toEqual(["Hello everyone"])
  })

  it("mentions the caller a Wire carries into the middle of a message", async () => {
    const result = await runProject(slottedGreetingProject(), [
      {
        type: "slashCommand",
        command: "greet",
        user: { id: "42", username: "kevin", displayName: "Kevin" }
      }
    ])

    expect(replies(result)).toEqual(["Hello <@42>, hello <@42>"])
  })

  it("puts a Number and a Boolean through their Coercion on the way into the text", async () => {
    const project = echoParameterProject()
    const flow = requireFirst(project.flows, "Flow")
    const trigger = requireFirst(flow.nodes, "Node")
    const reply = flow.nodes[1]
    if (reply === undefined) throw new Error("the fixture has no Reply Node")

    trigger.fields.parameters = [
      { name: "times", description: "How many times", type: "number", required: true },
      { name: "loudly", description: "Whether to shout", type: "boolean", required: true }
    ]
    reply.fields.content = [
      { kind: "literal", text: "x" },
      { kind: "slot", slot: "slot-times" },
      { kind: "literal", text: ", " },
      { kind: "slot", slot: "slot-loudly" }
    ]
    flow.wires = [
      requireFirst(flow.wires, "Wire"),
      {
        id: "wire-times",
        kind: "data",
        from: { node: "node-trigger", port: "parameter.times" },
        to: { node: "node-reply", port: "slot.slot-times" }
      },
      {
        id: "wire-loudly",
        kind: "data",
        from: { node: "node-trigger", port: "parameter.loudly" },
        to: { node: "node-reply", port: "slot.slot-loudly" }
      }
    ]

    const result = await runProject(project, [
      { type: "slashCommand", command: "echo", parameters: { times: 3, loudly: true } }
    ])

    expect(replies(result)).toEqual(["x3, true"])
  })

  it("leaves a Slot nobody wired anything to empty, rather than 'undefined'", async () => {
    const project = messageOf({ kind: "literal", text: "Hello " }, message, {
      kind: "slot",
      slot: "slot-nobody"
    })

    const result = await runProject(project, [
      { type: "slashCommand", command: "echo", parameters: { message: "Kevin" } }
    ])

    expect(replies(result)).toEqual(["Hello Kevin"])
  })

  it("refuses a message that does not read as text with Slots in it", () => {
    const project = helloProject()
    const reply = requireFirst(project.flows, "Flow").nodes[1]
    if (reply === undefined) throw new Error("the fixture has no Reply Node")
    reply.fields.content = "written by a build this one has never met"

    // Emitting an empty message instead would be the bot answering with
    // nothing and nowhere for the user to find out why.
    expect(() => compile(project, { mode: "build" })).toThrowError(/does not read as text/)
  })

  it("says the same thing in Development Mode as in Build", async () => {
    const events = [
      {
        type: "slashCommand",
        command: "greet",
        user: { id: "42", username: "kevin", displayName: "Kevin" }
      }
    ] as const
    const build = await runProject(slottedGreetingProject(), events, { mode: "build" })
    const development = await runProject(slottedGreetingProject(), events, {
      mode: "development"
    })

    expect(development.calls).toEqual(build.calls)
  })
})

describe("refusing a Project it cannot emit", () => {
  it("names the Node whose type is not in the catalogue", () => {
    const project = helloProject()
    const flow = requireFirst(project.flows, "Flow")
    requireFirst(flow.nodes, "Node").type = "discord.trigger.somethingElse"

    expect(() => compile(project, { mode: "build" })).toThrowError(CompilerError)
    expect(() => compile(project, { mode: "build" })).toThrowError(
      /discord\.trigger\.somethingElse/
    )
  })

  it("refuses a Flow with more than one Trigger", () => {
    const project = helloProject()
    const flow = requireFirst(project.flows, "Flow")
    flow.nodes.push({
      id: "node-other-trigger",
      type: "discord.trigger.slashCommand",
      position: { x: 0, y: 240 },
      fields: { name: "goodbye", description: "Says goodbye" }
    })

    expect(() => compile(project, { mode: "build" })).toThrowError(/single Trigger/)
  })

  it("refuses a Flow that loops back on itself", () => {
    const project = twoRepliesProject()
    const flow = requireFirst(project.flows, "Flow")
    flow.wires.push({
      id: "wire-loop",
      kind: "execution",
      from: { node: "node-second", port: "next" },
      to: { node: "node-reply", port: "in" }
    })

    expect(() => compile(project, { mode: "build" })).toThrowError(/loop back/)
  })

  it("refuses two Execution Wires leaving the same Port", () => {
    const project = twoRepliesProject()
    const flow = requireFirst(project.flows, "Flow")
    flow.wires.push({
      id: "wire-fan-out",
      kind: "execution",
      from: { node: "node-trigger", port: "next" },
      to: { node: "node-second", port: "in" }
    })

    expect(() => compile(project, { mode: "build" })).toThrowError(/exactly one/)
  })

  it("refuses two Data Wires arriving at the same input Port", () => {
    const project = greetingProject()
    const flow = requireFirst(project.flows, "Flow")
    flow.wires.push({
      id: "wire-data-again",
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-reply", port: "slot.slot-caller" }
    })

    expect(() => compile(project, { mode: "build" })).toThrowError(/exactly one value/)
  })

  it("refuses a Data Wire between Port types with no Coercion between them", () => {
    // The Wire of the greeting fixture, run the wrong way round the Coercion
    // table: text into a User. The editor would never draw it, and the Compiler
    // must not emit it either. A Slot's Port is always text, so the Node
    // demanding a User is one of this test's own.
    const producesText = withDataType(slashCommandTrigger, "user", "text")

    expect(() =>
      compile(userSinkProject(), {
        mode: "build",
        catalogue: buildCatalogue([producesText, userSink])
      })
    ).toThrowError(/no Coercion exists/)
  })

  it("compiles against a catalogue given to it", () => {
    const compiled = compile(helloProject(), {
      mode: "build",
      catalogue: buildCatalogue([slashCommandTrigger, reply])
    })

    expect(compiled.program.length).toBeGreaterThan(0)
  })
})

describe("registering a compiled Project's commands", () => {
  it("takes name, description and parameters from the Trigger Node's fields", async () => {
    const result = await runProject(parameterisedCommandProject(), [])

    expect(declarations(result)).toEqual([
      {
        name: "greet",
        description: "Greets someone",
        parameters: [
          { name: "who", description: "Who to greet", type: "user", required: true },
          { name: "times", description: "How many times", type: "number", required: false }
        ]
      }
    ])
  })

  it("declares no parameters for a command that asks for nothing", async () => {
    const result = await runProject(helloProject(), [])

    expect(declarations(result)).toEqual([{ name: "hello", description: "Says hello" }])
  })

  it("registers what the Project declared to a test server", async () => {
    const api = createFakeDiscordCommandApi()
    const target = { kind: "guild", guildId: "guild-1" } as const

    const result = await runProject(parameterisedCommandProject(), [])
    await registerCommands(api, target, declarations(result))

    expect(api.commandsFor(target)).toEqual([
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

  it("drops the previous command when the Trigger's name field is edited", async () => {
    const api = createFakeDiscordCommandApi()
    const target = { kind: "global" } as const

    const before = await runProject(helloProject(), [])
    await registerCommands(api, target, declarations(before))

    const renamed = helloProject()
    requireFirst(requireFirst(renamed.flows, "Flow").nodes, "Node").fields.name = "hola"
    const after = await runProject(renamed, [])
    const registration = await registerCommands(api, target, declarations(after))

    expect(registration.deleted).toEqual(["hello"])
    expect(api.commandsFor(target).map(command => command.name)).toEqual(["hola"])
  })
})

/**
 * Discord's limits, enforced once. What the editor stops the user at and what
 * the bot enforces are the same check, so these are written through
 * `runProject`: what matters is what the running bot does, not what was
 * emitted.
 */
describe("an Embed against Discord's limits", () => {
  /** The fixture with a piece of text the caller answers with, to feed a Slot. */
  const askingProject = () => {
    const project = embedReplyProject()
    const trigger = requireFirst(requireFirst(project.flows, "Flow").nodes, "Node")
    trigger.fields = {
      ...trigger.fields,
      parameters: [{ name: "who", description: "Whose card", type: "text", required: true }]
    }
    return project
  }

  it("takes the Failure Port when a value arrives along a Wire too long to send", async () => {
    const project = askingProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = embedNode(project)
    // Nothing typed here is over the limit: the title is a Slot, and what the
    // Wire carries is what turns out to be too long.
    node.fields = { ...node.fields, title: [{ kind: "slot", slot: "slot-name" }] }
    flow.wires.push({
      id: "wire-name",
      kind: "data",
      from: { node: "node-trigger", port: "parameter.who" },
      to: { node: "node-embed", port: "slot.slot-name" }
    })

    const result = await runProject(project, [
      { type: "slashCommand", command: "card", parameters: { who: "a".repeat(300) } }
    ])

    expect(result.calls.filter(call => call.method === "reply")).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(String(result.failures[0]?.error)).toContain(
      "the embed's title is 300 characters long, and Discord allows 256"
    )
  })

  it("refuses to build a bot whose Embed has nothing in it", () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = { ...node.fields, title: [], description: [] }

    expect(() => compile(project, { mode: "build" })).toThrowError(/nothing in it/)
  })

  it("stops a run whose Embed turns out to have nothing in it once the Wires arrived", async () => {
    const project = askingProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = embedNode(project)
    // A Slot is something to draw as far as the editor can tell; an empty value
    // arriving along the Wire is what leaves the Embed with nothing in it.
    node.fields = { ...node.fields, title: [], description: [{ kind: "slot", slot: "slot-text" }] }
    flow.wires.push({
      id: "wire-text",
      kind: "data",
      from: { node: "node-trigger", port: "parameter.who" },
      to: { node: "node-embed", port: "slot.slot-text" }
    })

    const result = await runProject(project, [
      { type: "slashCommand", command: "card", parameters: { who: "" } }
    ])

    expect(result.calls.filter(call => call.method === "reply")).toEqual([])
    expect(String(result.failures[0]?.error)).toContain("nothing in it")
  })

  it("refuses to build a bot whose Embed is over the total Discord budgets it", () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      description: literalText("a".repeat(4096)),
      footerText: literalText("b".repeat(1905))
    }

    expect(() => compile(project, { mode: "build" })).toThrowError(/Discord allows 6000/)
  })

  it("refuses to build a bot with more than the twenty-five pairs Discord accepts", () => {
    const project = embedReplyProject()
    const node = embedNode(project)
    node.fields = {
      ...node.fields,
      embedFields: Array.from({ length: 26 }, (_, index) => ({
        name: literalText(`Rule ${index + 1}`),
        value: literalText("Be kind"),
        inline: false
      }))
    }

    expect(() => compile(project, { mode: "build" })).toThrowError(/26 pairs/)
  })
})
