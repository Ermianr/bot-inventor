import { catalogue } from "@bot-inventor/nodes"
import { echoParameterProject, helloProject } from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import {
  connectWire,
  disconnectWire,
  moveNode,
  renameProject,
  setNodeField,
  updateFlow
} from "@/project/edits"

function flowOf(project = helloProject()) {
  const flow = project.flows[0]
  if (flow === undefined) throw new Error("the fixture has no Flow")
  return flow
}

describe("naming a Project", () => {
  it("takes the name the user typed", () => {
    const project = helloProject()
    const renamed = renameProject(project, "Moderation bot")

    expect(renamed.name).toBe("Moderation bot")
    expect(project.name).not.toBe("Moderation bot")
  })

  it("keeps everything else the Project holds", () => {
    const project = helloProject()
    const renamed = renameProject(project, "Moderation bot")

    expect(renamed.flows).toEqual(project.flows)
    expect(renamed.schemaVersion).toBe(project.schemaVersion)
  })

  it("drops the spaces around the name", () => {
    expect(renameProject(helloProject(), "  Moderation bot  ").name).toBe("Moderation bot")
  })

  it("refuses a blank name and keeps the one the Project had", () => {
    const project = helloProject()

    expect(renameProject(project, "").name).toBe(project.name)
    expect(renameProject(project, "   ").name).toBe(project.name)
  })
})

describe("editing a Project from the Canvas", () => {
  it("moves a Node without touching the others", () => {
    const flow = flowOf()
    const moved = moveNode(flow, "node-reply", { x: 10, y: 20 })

    expect(moved.nodes.find(node => node.id === "node-reply")?.position).toEqual({ x: 10, y: 20 })
    expect(moved.nodes.find(node => node.id === "node-trigger")?.position).toEqual({ x: 0, y: 0 })
    expect(flow.nodes.find(node => node.id === "node-reply")?.position).toEqual({ x: 320, y: 0 })
  })

  it("records what the user typed into a field", () => {
    const edited = setNodeField(flowOf(), catalogue, "node-trigger", "name", "goodbye")

    expect(edited.nodes.find(node => node.id === "node-trigger")?.fields.name).toBe("goodbye")
  })

  it("keeps the Wires that a field edit leaves alone", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-trigger",
      "description",
      "Says it back"
    )

    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution", "wire-data"])
  })

  it("takes away the Wire drawn from a parameter the user renamed", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-trigger",
      "parameters",
      [{ name: "text", description: "What to say", type: "text", required: true }]
    )

    // The Execution Wire is untouched: only the Port that went with the old
    // name took its Wire with it.
    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution"])
  })

  it("leaves a Wire dangling for a reason of its own where it is", () => {
    const flow = flowOf(echoParameterProject())
    flow.nodes.push({
      id: "node-second",
      type: "discord.interaction.reply",
      position: { x: 640, y: 0 },
      fields: {}
    })
    flow.wires.push({
      id: "wire-elsewhere",
      kind: "data",
      from: { node: "node-reply", port: "gone" },
      to: { node: "node-second", port: "content" }
    })

    // Typing into a Node's name must not quietly destroy Wires that edit had
    // nothing to do with: there is no undo, and nothing says it happened.
    const edited = setNodeField(flow, catalogue, "node-trigger", "name", "say")

    expect(edited.wires.map(wire => wire.id)).toContain("wire-elsewhere")
  })

  it("takes away the Wire drawn from a parameter the user removed", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-trigger",
      "parameters",
      []
    )

    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution"])
  })

  it("draws a Wire under an id no other Wire has", () => {
    const connected = connectWire(flowOf(), {
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-reply", port: "content" }
    })

    const ids = connected.wires.map(wire => wire.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(connected.wires.at(-1)).toMatchObject({ kind: "data" })
  })

  it("removes only the Wire that was disconnected", () => {
    const flow = flowOf()
    expect(disconnectWire(flow, "wire-execution").wires).toEqual([])
    expect(disconnectWire(flow, "wire-nothing").wires).toHaveLength(1)
  })

  it("replaces one Flow of the Project and leaves the rest alone", () => {
    const project = helloProject()
    project.flows.push({ id: "flow-other", name: "Other", nodes: [], wires: [] })

    const edited = updateFlow(project, "flow-hello", flow =>
      setNodeField(flow, catalogue, "node-trigger", "name", "goodbye")
    )

    expect(edited.flows[0]?.nodes[0]?.fields.name).toBe("goodbye")
    expect(edited.flows[1]).toBe(project.flows[1])
  })
})
