import type { Flow, PortReference, Project, Wire, WireKind } from "@bot-inventor/schema"

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

  // The Node's own fields, because which Ports it has is partly up to them.
  return findPort(definition, reference.port, node.fields)
}

/**
 * The Wires of a Flow whose Ports are no longer there.
 *
 * A Port can stop existing while the Project is open: renaming or removing a
 * slash command parameter takes its Port with it, and the Wires drawn to it are
 * left pointing at nothing. Those Wires are what this finds, so that the editor
 * can clear them and say so, and the Compiler can refuse rather than quietly
 * emit a Flow missing a value the user believes they wired.
 */
export function findDanglingWires(flow: Flow, catalogue: NodeCatalogue): readonly Wire[] {
  return flow.wires.filter(wire => danglingEndsOf(flow, catalogue, wire).length > 0)
}

/**
 * The ends of one Wire that name a Port which is not there, in the order they
 * are drawn. It is what tells the user which Node to look at: a Wire is usually
 * left dangling by its source losing a Port, not its target.
 */
export function danglingEndsOf(
  flow: Flow,
  catalogue: NodeCatalogue,
  wire: Wire
): readonly PortReference[] {
  return [wire.from, wire.to].filter(end => isDangling(flow, catalogue, end))
}

/**
 * Whether one end of a Wire names a Port its Node does not declare.
 *
 * A Node that is not on the Flow, or whose type this build does not know, is
 * not this: both are the Project being wrong about something bigger, they are
 * reported in their own words, and a Wire is not the user's mistake to lose
 * over a Node a newer build wrote.
 */
function isDangling(flow: Flow, catalogue: NodeCatalogue, reference: PortReference): boolean {
  const node = flow.nodes.find(candidate => candidate.id === reference.node)
  if (node === undefined) return false

  const definition = catalogue.get(node.type)
  if (definition === undefined) return false

  return findPort(definition, reference.port, node.fields) === undefined
}

/**
 * The Flow with its dangling Wires removed.
 *
 * `nodeId` narrows it to the Wires touching one Node, which is what an edit to
 * that Node is allowed to take away. A Wire dangling for some other reason — a
 * Port a newer build declared and this one does not — is not that edit's to
 * destroy, and losing it while typing into an unrelated field is a deletion the
 * user neither asked for nor saw.
 */
export function pruneDanglingWires(flow: Flow, catalogue: NodeCatalogue, nodeId?: string): Flow {
  const dangling = new Set(
    findDanglingWires(flow, catalogue)
      .filter(wire => nodeId === undefined || wire.from.node === nodeId || wire.to.node === nodeId)
      .map(wire => wire.id)
  )
  if (dangling.size === 0) return flow
  return { ...flow, wires: flow.wires.filter(wire => !dangling.has(wire.id)) }
}

/** Every Flow of a Project with its dangling Wires removed. */
export function pruneProjectWires(project: Project, catalogue: NodeCatalogue): Project {
  return { ...project, flows: project.flows.map(flow => pruneDanglingWires(flow, catalogue)) }
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
