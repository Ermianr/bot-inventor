import { z } from "zod"

/**
 * The Project format version this build of the app reads and writes. Every
 * change to the shapes below raises it and ships a migration (see
 * `migrations.ts`).
 */
export const CURRENT_SCHEMA_VERSION = 2

/** Identifiers are opaque strings, unique within the collection that holds them. */
const identifier = z.string().min(1, "an identifier must not be empty").describe("identifier")

/** A position on the Canvas, in Canvas coordinates. */
export const positionSchema = z.object({
  x: z.number(),
  y: z.number()
})

/** Any value a Node field can hold inline, i.e. anything JSON can carry. */
export type FieldValue =
  | string
  | number
  | boolean
  | null
  | FieldValue[]
  | { [key: string]: FieldValue }

export const fieldValueSchema: z.ZodType<FieldValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(fieldValueSchema),
    z.record(z.string(), fieldValueSchema)
  ])
)

/** One end of a Wire: a Port on a Node. */
export const portReferenceSchema = z.object({
  node: identifier,
  port: identifier
})

/**
 * A Wire between two Ports. An Execution Wire defines the order things happen
 * in; a Data Wire carries a value from one Node's output to another's input.
 */
export const wireSchema = z.object({
  id: identifier,
  kind: z.enum(["execution", "data"]),
  from: portReferenceSchema,
  to: portReferenceSchema
})

/**
 * A Node instance placed on a Canvas: which Node of the catalogue it is, where
 * it sits, and the values typed into its fields.
 */
export const nodeSchema = z.object({
  id: identifier,
  /** The catalogue id of the Node, e.g. `discord.member.addRole`. */
  type: identifier,
  position: positionSchema,
  fields: z.record(z.string(), fieldValueSchema).default({})
})

/** The whole graph hanging off a single Trigger. */
export const flowSchema = z
  .object({
    id: identifier,
    name: z.string().min(1, "a Flow must have a name"),
    nodes: z.array(nodeSchema),
    wires: z.array(wireSchema)
  })
  .check(ctx => {
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
export function projectSchemaForVersion(version: number) {
  return z
    .object({
      schemaVersion: z.literal(version),
      id: identifier,
      name: z.string().min(1, "a Project must have a name"),
      flows: z.array(flowSchema)
    })
    .check(ctx => {
      reportDuplicates(
        ctx,
        ctx.value.flows.map(flow => flow.id),
        "flows",
        "Flow"
      )
    })
}

/** The Project format this build reads and writes. This is what other packages parse with. */
export const projectSchema = projectSchemaForVersion(CURRENT_SCHEMA_VERSION)

export type Position = z.infer<typeof positionSchema>
export type PortReference = z.infer<typeof portReferenceSchema>
export type Wire = z.infer<typeof wireSchema>
export type Node = z.infer<typeof nodeSchema>
export type Flow = z.infer<typeof flowSchema>
export type Project = z.infer<typeof projectSchema>

/** The kind of Wire, spelled the way `CONTEXT.md` spells it. */
export type WireKind = Wire["kind"]

function reportDuplicates(
  ctx: { value: unknown; issues: z.core.$ZodRawIssue[] },
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
