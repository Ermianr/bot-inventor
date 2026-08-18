import type { Migration } from "./migrations.js"
import { literalText } from "./slotted-text.js"

/**
 * The fields that became sequences of literals and Slots in Project format 2
 * (ADR 0010), by the catalogue id of the Node that owns them.
 *
 * They are written out here rather than read off the catalogue on purpose: this
 * step describes what version 1 meant, while the catalogue describes what this
 * build means. A field that becomes Slotted later ships its own step.
 */
const SLOTTED_FIELDS: Record<string, readonly string[]> = {
  "discord.interaction.reply": ["content"]
}

/**
 * Turns every text field that became Slotted into a single literal segment.
 *
 * The document is whatever version 1 wrote, so nothing here assumes more than
 * the shape it reads: anything that is not a Node holding a string in one of
 * those fields is left exactly as it is, and the schema of version 2 is what
 * refuses it afterwards.
 */
export const toSlottedText: Migration = {
  from: 1,
  to: 2,
  migrate(document) {
    if (!isRecord(document)) return document

    const flows = Array.isArray(document.flows)
      ? document.flows.map(flow => migrateFlow(flow))
      : document.flows

    return { ...document, schemaVersion: 2, flows }
  }
}

function migrateFlow(flow: unknown): unknown {
  if (!isRecord(flow) || !Array.isArray(flow.nodes)) return flow
  return { ...flow, nodes: flow.nodes.map(node => migrateNode(node)) }
}

function migrateNode(node: unknown): unknown {
  if (!isRecord(node) || typeof node.type !== "string") return node

  const slotted = SLOTTED_FIELDS[node.type]
  if (slotted === undefined || !isRecord(node.fields)) return node

  const fields: Record<string, unknown> = { ...node.fields }
  for (const id of slotted) {
    const value = fields[id]
    if (typeof value === "string") fields[id] = literalText(value)
  }
  return { ...node, fields }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
