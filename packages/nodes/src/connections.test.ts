import type { Flow, PortReference } from "@bot-inventor/schema"
import { describe, expect, it } from "vitest"
import { buildCatalogue } from "./catalogue.js"
import { checkConnection, findDanglingWires, pruneDanglingWires } from "./connections.js"
import type { NodeDefinition } from "./definition.js"
import { reply } from "./discord/reply.js"
import { slashCommandTrigger } from "./discord/slash-command-trigger.js"

/**
 * A Node with a text output, which the catalogue has none of yet. It is what
 * makes the pair "text into User" — the pair the Coercion table deliberately
 * has no entry for — statable at all.
 */
const textSource: NodeDefinition = {
  id: "test.textSource",
  labelKey: "test.textSource.label",
  descriptionKey: "test.textSource.description",
  isTrigger: false,
  ports: [
    { id: "in", kind: "execution", direction: "input", labelKey: "ports.in.label" },
    {
      id: "text",
      kind: "data",
      direction: "output",
      dataType: "text",
      labelKey: "test.textSource.ports.text.label"
    }
  ],
  fields: [],
  generate: () => ""
}

/**
 * A Node with a User input, for the same reason: the Reply Node's only Data
 * input takes text.
 */
const userSink: NodeDefinition = {
  id: "test.userSink",
  labelKey: "test.userSink.label",
  descriptionKey: "test.userSink.description",
  isTrigger: false,
  ports: [
    {
      id: "who",
      kind: "data",
      direction: "input",
      dataType: "user",
      labelKey: "test.userSink.ports.who.label"
    }
  ],
  fields: [],
  generate: () => ""
}

const catalogue = buildCatalogue([slashCommandTrigger, reply, textSource, userSink])

/**
 * A Flow with the two Nodes of the catalogue on it and nothing wired, so each
 * test states exactly the Wires its case is about.
 */
function bareFlow(): Flow {
  return {
    id: "flow-test",
    name: "Test",
    nodes: [
      {
        id: "node-trigger",
        type: "discord.trigger.slashCommand",
        position: { x: 0, y: 0 },
        fields: {}
      },
      {
        id: "node-reply",
        type: "discord.interaction.reply",
        position: { x: 320, y: 0 },
        fields: {}
      },
      {
        id: "node-second-reply",
        type: "discord.interaction.reply",
        position: { x: 640, y: 0 },
        fields: {}
      },
      {
        id: "node-text-source",
        type: "test.textSource",
        position: { x: 0, y: 240 },
        fields: {}
      },
      {
        id: "node-user-sink",
        type: "test.userSink",
        position: { x: 320, y: 240 },
        fields: {}
      }
    ],
    wires: []
  }
}

function port(node: string, portId: string): PortReference {
  return { node, port: portId }
}

function check(flow: Flow, from: PortReference, to: PortReference) {
  return checkConnection({ flow, catalogue, from, to })
}

describe("checking whether a Wire is legal", () => {
  it("accepts an Execution Wire without coercing anything", () => {
    expect(check(bareFlow(), port("node-trigger", "next"), port("node-reply", "in"))).toEqual({
      legal: true,
      kind: "execution",
      coercion: undefined
    })
  })

  it("accepts the caller into a text input, and says it coerces", () => {
    const result = check(bareFlow(), port("node-trigger", "user"), port("node-reply", "content"))

    expect(result).toMatchObject({ legal: true, kind: "data" })
    expect(result.legal && result.coercion).toMatchObject({ runtimeCall: "userToText" })
  })

  it("rejects a Wire between an Execution Port and a Data Port", () => {
    expect(check(bareFlow(), port("node-trigger", "next"), port("node-reply", "content"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.kind"
    })
  })

  it("rejects a Wire that does not run from an output to an input", () => {
    expect(check(bareFlow(), port("node-reply", "content"), port("node-trigger", "user"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.direction"
    })
  })

  it("rejects a Wire between Data types with no Coercion between them", () => {
    expect(
      check(bareFlow(), port("node-text-source", "text"), port("node-user-sink", "who"))
    ).toEqual({
      legal: false,
      reasonKey: "connections.rejected.dataType"
    })
  })

  it("rejects a Wire onto a Port the Node does not declare", () => {
    expect(check(bareFlow(), port("node-trigger", "next"), port("node-reply", "nowhere"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.unknownPort"
    })
  })

  it("rejects a Wire onto a Node that is not in the Flow", () => {
    expect(check(bareFlow(), port("node-trigger", "next"), port("node-missing", "in"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.unknownPort"
    })
  })

  it("rejects a Wire from a Node to itself", () => {
    expect(check(bareFlow(), port("node-reply", "next"), port("node-reply", "in"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.cycle"
    })
  })

  it("rejects a second Wire leaving an Execution output Port", () => {
    const flow = bareFlow()
    flow.wires.push({
      id: "wire-execution",
      kind: "execution",
      from: port("node-trigger", "next"),
      to: port("node-reply", "in")
    })

    expect(check(flow, port("node-trigger", "next"), port("node-second-reply", "in"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.executionOutputTaken"
    })
  })

  it("rejects a second Wire arriving at a Data input Port", () => {
    const flow = bareFlow()
    flow.wires.push({
      id: "wire-data",
      kind: "data",
      from: port("node-trigger", "user"),
      to: port("node-reply", "content")
    })

    expect(check(flow, port("node-trigger", "user"), port("node-reply", "content"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.dataInputTaken"
    })
  })

  it("accepts a second Wire leaving a Data output Port, which feeds as many inputs as it likes", () => {
    const flow = bareFlow()
    flow.wires.push({
      id: "wire-data",
      kind: "data",
      from: port("node-trigger", "user"),
      to: port("node-reply", "content")
    })

    expect(
      check(flow, port("node-trigger", "user"), port("node-second-reply", "content"))
    ).toMatchObject({ legal: true })
  })

  it("accepts a Wire from a Port a slash command parameter declared", () => {
    const flow = bareFlow()
    const trigger = flow.nodes[0]
    if (trigger === undefined) throw new Error("the Flow has no Trigger")
    trigger.fields = {
      parameters: [{ name: "message", description: "What to say", type: "text", required: true }]
    }

    expect(
      check(flow, port("node-trigger", "parameter.message"), port("node-reply", "content"))
    ).toEqual({ legal: true, kind: "data", coercion: undefined })
  })

  it("rejects a Wire that closes a cycle", () => {
    const flow = bareFlow()
    flow.wires.push({
      id: "wire-execution",
      kind: "execution",
      from: port("node-reply", "next"),
      to: port("node-second-reply", "in")
    })

    expect(check(flow, port("node-second-reply", "next"), port("node-reply", "in"))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.cycle"
    })
  })
})

describe("Wires left pointing at a Port that is no longer there", () => {
  /** A Flow whose reply reads a parameter Port, which a test can then take away. */
  function wiredToAParameter(): Flow {
    const flow = bareFlow()
    const trigger = flow.nodes[0]
    if (trigger === undefined) throw new Error("the Flow has no Trigger")
    trigger.fields = {
      parameters: [{ name: "message", description: "What to say", type: "text", required: true }]
    }
    flow.wires.push(
      {
        id: "wire-execution",
        kind: "execution",
        from: port("node-trigger", "next"),
        to: port("node-reply", "in")
      },
      {
        id: "wire-data",
        kind: "data",
        from: port("node-trigger", "parameter.message"),
        to: port("node-reply", "content")
      }
    )
    return flow
  }

  it("finds none while every Port a Wire names is still declared", () => {
    expect(findDanglingWires(wiredToAParameter(), catalogue)).toEqual([])
  })

  it("finds the Wire whose parameter was renamed", () => {
    const flow = wiredToAParameter()
    const trigger = flow.nodes[0]
    if (trigger === undefined) throw new Error("the Flow has no Trigger")
    trigger.fields = {
      parameters: [{ name: "text", description: "What to say", type: "text", required: true }]
    }

    expect(findDanglingWires(flow, catalogue).map(wire => wire.id)).toEqual(["wire-data"])
    expect(pruneDanglingWires(flow, catalogue).wires.map(wire => wire.id)).toEqual([
      "wire-execution"
    ])
  })

  it("hands back the Flow it was given when there is nothing to take away", () => {
    const flow = wiredToAParameter()

    expect(pruneDanglingWires(flow, catalogue)).toBe(flow)
  })
})
