import { describe, expect, it, vi } from "vitest"
import { helloProject } from "./fixtures.js"
import { toSlottedText } from "./migrate-to-slotted-text.js"
import { openProject } from "./open-project.js"
import { CURRENT_SCHEMA_VERSION } from "./project.js"

/** `helloProject` as version 1 wrote it: the reply's message is a plain string. */
function version1Hello(): Record<string, unknown> {
  const project = helloProject()
  const document = structuredClone(project) as unknown as {
    schemaVersion: number
    flows: { nodes: { fields: Record<string, unknown> }[] }[]
  }
  document.schemaVersion = 1
  const reply = document.flows[0]?.nodes[1]
  if (reply === undefined) throw new Error("the fixture has no Reply Node")
  reply.fields = { content: "Hello!", ephemeral: false }
  return document as unknown as Record<string, unknown>
}

describe("toSlottedText", () => {
  it("turns a text field into a single literal segment", () => {
    const migrated = toSlottedText.migrate(version1Hello())

    expect(migrated).toEqual(helloProject())
  })

  it("leaves a field that is not text alone", () => {
    const document = version1Hello()
    const nodes = (document.flows as { nodes: { fields: Record<string, unknown> }[] }[])[0]?.nodes
    const reply = nodes?.[1]
    if (reply === undefined) throw new Error("the fixture has no Reply Node")
    reply.fields = { content: 7, ephemeral: false }

    const migrated = toSlottedText.migrate(document) as typeof document
    const migratedNodes = (migrated.flows as { nodes: { fields: Record<string, unknown> }[] }[])[0]
      ?.nodes

    expect(migratedNodes?.[1]?.fields.content).toBe(7)
  })

  it("leaves a Node of another type alone", () => {
    const document = version1Hello()
    const flow = (document.flows as { nodes: { fields: Record<string, unknown> }[] }[])[0]
    const trigger = flow?.nodes[0]

    const migrated = toSlottedText.migrate(document) as typeof document
    const migratedTrigger = (
      migrated.flows as { nodes: { fields: Record<string, unknown> }[] }[]
    )[0]?.nodes[0]

    expect(migratedTrigger).toEqual(trigger)
  })
})

describe("opening a Project written at the previous version", () => {
  it("backs it up, migrates every text field and opens it", async () => {
    const document = version1Hello()
    const backup = vi.fn(async () => {})

    const result = await openProject(document, { writeBackup: backup })

    expect(backup).toHaveBeenCalledWith(document)
    expect(result).toMatchObject({ status: "opened", migrated: true })
    if (result.status === "opened") {
      expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(result.project).toEqual(helloProject())
    }
  })
})
