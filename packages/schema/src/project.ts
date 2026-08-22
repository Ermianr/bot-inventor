import {
  _default as defaultingTo,
  array,
  boolean,
  type core,
  enum as enumOf,
  lazy,
  literal,
  minLength,
  null as nullValue,
  number,
  object,
  record,
  string,
  union
} from "zod/mini"

import "./english-messages.js"
import type { Validator } from "./validator.js"

/**
 * The Project format version this build of the app reads and writes. Every
 * change to the shapes below raises it and ships a migration (see
 * `migrations.ts`).
 */
export const CURRENT_SCHEMA_VERSION = 2

/** Identifiers are opaque strings, unique within the collection that holds them. */
const identifier = string().check(minLength(1, "an identifier must not be empty"))

/** A position on the Canvas, in Canvas coordinates. */
export type Position = {
  x: number
  y: number
}

export const positionSchema: Validator<Position> = object({
  x: number(),
  y: number()
})

/** Any value a Node field can hold inline, i.e. anything JSON can carry. */
export type FieldValue =
  | string
  | number
  | boolean
  | null
  | FieldValue[]
  | { [key: string]: FieldValue }

export const fieldValueSchema: Validator<FieldValue> = lazy(() =>
  union([
    string(),
    number(),
    boolean(),
    nullValue(),
    array(fieldValueSchema),
    record(string(), fieldValueSchema)
  ])
)

/** One end of a Wire: a Port on a Node. */
export type PortReference = {
  node: string
  port: string
}

export const portReferenceSchema: Validator<PortReference> = object({
  node: identifier,
  port: identifier
})

/**
 * A Wire between two Ports. An Execution Wire defines the order things happen
 * in; a Data Wire carries a value from one Node's output to another's input.
 */
export type Wire = {
  id: string
  kind: WireKind
  from: PortReference
  to: PortReference
}

/** The kind of Wire, spelled the way `CONTEXT.md` spells it. */
export type WireKind = "execution" | "data"

export const wireSchema: Validator<Wire> = object({
  id: identifier,
  kind: enumOf(["execution", "data"]),
  from: portReferenceSchema,
  to: portReferenceSchema
})

/**
 * A Node instance placed on a Canvas: which Node of the catalogue it is, where
 * it sits, and the values typed into its fields.
 */
export type Node = {
  id: string
  /** The catalogue id of the Node, e.g. `discord.member.addRole`. */
  type: string
  position: Position
  fields: Record<string, FieldValue>
}

export const nodeSchema: Validator<Node> = object({
  id: identifier,
  /** The catalogue id of the Node, e.g. `discord.member.addRole`. */
  type: identifier,
  position: positionSchema,
  fields: defaultingTo(record(string(), fieldValueSchema), {})
})

/** The whole graph hanging off a single Trigger. */
export type Flow = {
  id: string
  name: string
  nodes: Node[]
  wires: Wire[]
}

export const flowSchema: Validator<Flow> = object({
  id: identifier,
  name: string().check(minLength(1, "a Flow must have a name")),
  nodes: array(nodeSchema),
  wires: array(wireSchema)
}).check(ctx => {
  const flow = ctx.value

  reportDuplicates(
    ctx,
    flow.nodes.map(node => node.id),
    "nodes",
    "Node"
  )
  reportDuplicates(
    ctx,
    flow.wires.map(wire => wire.id),
    "wires",
    "Wire"
  )

  const nodeIds = new Set(flow.nodes.map(node => node.id))
  for (const [index, wire] of flow.wires.entries()) {
    for (const end of ["from", "to"] as const) {
      if (!nodeIds.has(wire[end].node)) {
        ctx.issues.push({
          code: "custom",
          input: flow,
          path: ["wires", index, end, "node"],
          message: `Wire "${wire.id}" points at Node "${wire[end].node}", which is not in this Flow`
        })
      }
    }
  }
})

/**
 * The complete definition of one bot at a given format version: the unit the
 * user opens, edits and saves.
 *
 * The version is pinned rather than merely well-formed, so a document from a
 * newer build is refused instead of parsed optimistically, and so a migration
 * that forgets to raise `schemaVersion` fails loudly.
 */
export type Project = {
  schemaVersion: number
  id: string
  name: string
  flows: Flow[]
}

export function projectSchemaForVersion(version: number): Validator<Project> {
  return object({
    schemaVersion: literal(version),
    id: identifier,
    name: string().check(minLength(1, "a Project must have a name")),
    flows: array(flowSchema)
  }).check(ctx => {
    reportDuplicates(
      ctx,
      ctx.value.flows.map(flow => flow.id),
      "flows",
      "Flow"
    )
  })
}

/** The Project format this build reads and writes. This is what other packages parse with. */
export const projectSchema: Validator<Project> = projectSchemaForVersion(CURRENT_SCHEMA_VERSION)

function reportDuplicates(
  ctx: { value: unknown; issues: core.$ZodRawIssue[] },
  ids: string[],
  key: string,
  label: string
): void {
  const seen = new Set<string>()
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        path: [key, index, "id"],
        message: `duplicate ${label} id "${id}"`
      })
    }
    seen.add(id)
  }
}
