import { helloProject } from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import { connectWire, disconnectWire, moveNode, setNodeField, updateFlow } from "@/project/edits"

function flowOf(project = helloProject()) {
  const flow = project.flows[0]
  if (flow === undefined) throw new Error("the fixture has no Flow")
  return flow
}

describe("editing a Project from the Canvas", () => {
  it("moves a Node without touching the others", () => {
    const flow = flowOf()
    const moved = moveNode(flow, "node-reply", { x: 10, y: 20 })

    expect(moved.nodes.find(node => node.id === "node-reply")?.position).toEqual({ x: 10, y: 20 })
    expect(moved.nodes.find(node => node.id === "node-trigger")?.position).toEqual({ x: 0, y: 0 })
    expect(flow.nodes.find(node => node.id === "node-reply")?.position).toEqual({ x: 320, y: 0 })
  })

  it("records what the user typed into a field", () => {
    const edited = setNodeField(flowOf(), "node-trigger", "name", "goodbye")

    expect(edited.nodes.find(node => node.id === "node-trigger")?.fields.name).toBe("goodbye")
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
      setNodeField(flow, "node-trigger", "name", "goodbye")
    )

    expect(edited.flows[0]?.nodes[0]?.fields.name).toBe("goodbye")
    expect(edited.flows[1]).toBe(project.flows[1])
  })
})
