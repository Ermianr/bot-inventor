import {
  buildCatalogue,
  type DataType,
  type NodeDefinition,
  reply,
  slashCommandTrigger
} from "@bot-inventor/nodes"
import type { RecordedCall } from "@bot-inventor/runtime/testing"
import type { Project } from "@bot-inventor/schema"
import {
  emptyProject,
  greetingProject,
  helloProject,
  requireFirst,
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

/** `helloProject` with a second Reply wired after the first. */
function twoRepliesProject(): Project {
  const project = helloProject()
  const flow = requireFirst(project.flows, "Flow")
  flow.nodes.push({
    id: "node-second",
    type: "discord.interaction.reply",
    position: { x: 640, y: 0 },
    fields: { content: "And again", ephemeral: false }
  })
  flow.wires.push({
    id: "wire-second",
    kind: "execution",
    from: { node: "node-reply", port: "next" },
    to: { node: "node-second", port: "in" }
  })
  return project
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
      to: { node: "node-reply", port: "content" }
    })

    expect(() => compile(project, { mode: "build" })).toThrowError(/exactly one value/)
  })

  it("refuses a Data Wire between Port types with no Coercion between them", () => {
    // The Wire of the greeting fixture, run the wrong way round the Coercion
    // table: text into a User. The editor would never draw it, and the Compiler
    // must not emit it either.
    const producesText = withDataType(slashCommandTrigger, "user", "text")
    const demandsAUser = withDataType(reply, "content", "user")

    expect(() =>
      compile(greetingProject(), {
        mode: "build",
        catalogue: buildCatalogue([producesText, demandsAUser])
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
