import { describe, expect, it } from "vitest"
import {
  danglingWireProject,
  emptyProject,
  futureVersionProject,
  greetingProject,
  requireFirst
} from "./fixtures.js"
import { formatProjectIssues } from "./open-project.js"
import { CURRENT_SCHEMA_VERSION, projectSchema } from "./project.js"

describe("projectSchema", () => {
  it("parses the fixtures", () => {
    expect(projectSchema.parse(emptyProject())).toEqual(emptyProject())
    expect(projectSchema.parse(greetingProject())).toEqual(greetingProject())
  })

  it("defaults a Node with no fields to an empty set of fields", () => {
    const project = greetingProject()
    const flow = requireFirst(project.flows, "Flow")
    const node = requireFirst(flow.nodes, "Node")
    const parsed = projectSchema.parse({
      ...project,
      flows: [{ ...flow, nodes: [{ ...node, fields: undefined }], wires: [] }]
    })

    expect(parsed.flows[0]?.nodes[0]?.fields).toEqual({})
  })

  it("rejects a document that is not a Project at all", () => {
    const result = projectSchema.safeParse({ hello: "world" })

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? [])).toEqual(
      expect.arrayContaining([expect.stringContaining("schemaVersion")])
    )
  })

  it("names the field that is wrong", () => {
    const project = greetingProject()
    const broken = {
      ...project,
      flows: [{ ...requireFirst(project.flows, "Flow"), name: "" }]
    }

    const result = projectSchema.safeParse(broken)

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? [])).toContain(
      "flows.0.name: a Flow must have a name"
    )
  })

  it("rejects a Node position that is not a point on the Canvas", () => {
    const project = greetingProject()
    const flow = requireFirst(project.flows, "Flow")
    const broken = {
      ...project,
      flows: [
        {
          ...flow,
          nodes: [{ ...requireFirst(flow.nodes, "Node"), position: { x: "left", y: 0 } }],
          wires: []
        }
      ]
    }

    const result = projectSchema.safeParse(broken)

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? []).join("\n")).toContain(
      "flows.0.nodes.0.position.x"
    )
  })

  it("rejects duplicate Node ids within a Flow", () => {
    const project = greetingProject()
    const flow = requireFirst(project.flows, "Flow")
    const broken = {
      ...project,
      flows: [
        {
          ...flow,
          nodes: [requireFirst(flow.nodes, "Node"), requireFirst(flow.nodes, "Node")],
          wires: []
        }
      ]
    }

    const result = projectSchema.safeParse(broken)

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? [])).toContain(
      'flows.0.nodes.1.id: duplicate Node id "node-trigger"'
    )
  })

  it("rejects duplicate Flow ids within a Project", () => {
    const project = emptyProject()
    const broken = {
      ...project,
      flows: [requireFirst(project.flows, "Flow"), requireFirst(project.flows, "Flow")]
    }

    const result = projectSchema.safeParse(broken)

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? [])).toContain(
      'flows.1.id: duplicate Flow id "flow-main"'
    )
  })

  it("rejects a Wire pointing at a Node that is not in the Flow", () => {
    const result = projectSchema.safeParse(danglingWireProject())

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? [])).toContain(
      'flows.0.wires.0.to.node: Wire "wire-execution" points at Node "node-missing", which is not in this Flow'
    )
  })

  it("rejects a Wire that is neither an Execution Wire nor a Data Wire", () => {
    const project = greetingProject()
    const flow = requireFirst(project.flows, "Flow")
    const broken = {
      ...project,
      flows: [{ ...flow, wires: [{ ...requireFirst(flow.wires, "Wire"), kind: "magic" }] }]
    }

    expect(projectSchema.safeParse(broken).success).toBe(false)
  })

  it("keeps editor state out of the Project", () => {
    const parsed = projectSchema.parse({ ...emptyProject(), zoom: 1.5, theme: "dark" })

    expect(parsed).not.toHaveProperty("zoom")
    expect(parsed).not.toHaveProperty("theme")
  })

  it("refuses a newer format on its own, without going through openProject", () => {
    const result = projectSchema.safeParse(futureVersionProject())

    expect(result.success).toBe(false)
    expect(formatProjectIssues(result.error?.issues ?? []).join("\n")).toContain("schemaVersion")
  })

  it("pins the current schemaVersion", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(emptyProject().schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})
