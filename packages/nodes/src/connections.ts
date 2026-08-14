import type { Flow, PortReference, WireKind } from "@bot-inventor/schema"
import type { NodeCatalogue } from "./catalogue.js"
import { type CoercionDefinition, findCoercion } from "./coercions.js"
import { findPort, type PortDefinition } from "./definition.js"

/**
 * Whether a Wire may be drawn between two Ports, and what it costs. The editor
 * asks this while the user is still dragging, so it answers from the Flow, the
 * Port declarations and the Coercion table alone — never from the Compiler.
 */
export type ConnectionCheck =
  | {
      legal: true
      /** Which kind of Wire this would be, which is what the editor records. */
      kind: WireKind
      /** The Coercion the Wire applies, or `undefined` when the types already match. */
      coercion: CoercionDefinition | undefined
    }
  | {
      legal: false
      /** Why the editor refused it, as a key for the i18n layer. */
      reasonKey: string
    }

/** The Wire the user is dragging, in the Flow they are dragging it on. */
export type ConnectionRequest = {
  flow: Flow
  catalogue: NodeCatalogue
  from: PortReference
  to: PortReference
}

/**
 * Answers "is this connection legal, and does it coerce?" for a Wire the user
 * is drawing. Two Port declarations are not enough to answer it: the Wires
 * already on the Flow decide whether one more may leave an Execution output or
 * arrive at a Data input, and whether it would close a cycle.
 *
 * One thing the Compiler checks is still missing here: it also refuses a Data
 * Wire whose source does not run before its target. No Node in the catalogue
 * can be wired that way yet — only the Trigger has a Data output, and the
 * Trigger always runs first — but the first Node with a Data input and a Data
 * output makes it reachable, and it belongs here when that Node lands.
 */
export function checkConnection(request: ConnectionRequest): ConnectionCheck {
  const from = findFlowPort(request.flow, request.catalogue, request.from)
  const to = findFlowPort(request.flow, request.catalogue, request.to)
  if (from === undefined || to === undefined) {
    return { legal: false, reasonKey: "connections.rejected.unknownPort" }
  }

  if (from.direction !== "output" || to.direction !== "input") {
    return { legal: false, reasonKey: "connections.rejected.direction" }
  }

  if (from.kind !== to.kind) {
    return { legal: false, reasonKey: "connections.rejected.kind" }
  }

  if (from.kind === "execution" && to.kind === "execution") {
    if (occupied(request.flow, "execution", wire => sameEnd(wire.from, request.from))) {
      return { legal: false, reasonKey: "connections.rejected.executionOutputTaken" }
    }
    if (closesCycle(request)) {
      return { legal: false, reasonKey: "connections.rejected.cycle" }
    }
    // An Execution Wire carries no value, so there is nothing left to check.
    return { legal: true, kind: "execution", coercion: undefined }
  }

  if (from.kind !== "data" || to.kind !== "data") {
    return { legal: false, reasonKey: "connections.rejected.kind" }
  }

  if (occupied(request.flow, "data", wire => sameEnd(wire.to, request.to))) {
    return { legal: false, reasonKey: "connections.rejected.dataInputTaken" }
  }

  if (from.dataType === to.dataType) return { legal: true, kind: "data", coercion: undefined }

  const coercion = findCoercion(from.dataType, to.dataType)
  if (coercion === undefined) {
    return { legal: false, reasonKey: "connections.rejected.dataType" }
  }
  return { legal: true, kind: "data", coercion }
}

/**
 * The Port one end of a Wire names, resolved through the Flow and the
 * catalogue. It answers `undefined` for a Node or a Port that is not there,
 * which is what a Wire drawn against a Project that has moved on looks like.
 */
export function findFlowPort(
  flow: Flow,
  catalogue: NodeCatalogue,
  reference: PortReference
): PortDefinition | undefined {
  const node = flow.nodes.find(candidate => candidate.id === reference.node)
  if (node === undefined) return undefined

  const definition = catalogue.get(node.type)
  if (definition === undefined) return undefined

  return findPort(definition, reference.port)
}

function sameEnd(end: PortReference, reference: PortReference): boolean {
  return end.node === reference.node && end.port === reference.port
}

function occupied(
  flow: Flow,
  kind: WireKind,
  matches: (wire: Flow["wires"][number]) => boolean
): boolean {
  return flow.wires.some(wire => wire.kind === kind && matches(wire))
}

/**
 * Whether the new Wire would let a run reach a Node it has already run. The
 * Compiler refuses those, so the editor has to refuse them while the user can
 * still see what they were dragging.
 */
function closesCycle(request: ConnectionRequest): boolean {
  if (request.from.node === request.to.node) return true

  const successors = new Map<string, string[]>()
  for (const wire of request.flow.wires) {
    if (wire.kind !== "execution") continue
    const reached = successors.get(wire.from.node) ?? []
    reached.push(wire.to.node)
    successors.set(wire.from.node, reached)
  }

  const seen = new Set<string>()
  const pending = [request.to.node]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    if (current === request.from.node) return true
    if (seen.has(current)) continue
    seen.add(current)
    pending.push(...(successors.get(current) ?? []))
  }
  return false
}
