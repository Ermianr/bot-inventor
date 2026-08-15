import { type NodeCatalogue, pruneDanglingWires } from "@bot-inventor/nodes"
import type {
  FieldValue,
  Flow,
  PortReference,
  Position,
  Project,
  WireKind
} from "@bot-inventor/schema"

/**
 * Every change the Canvas makes to a Project, as pure functions.
 *
 * They return a new Project rather than mutating one: the editor renders from
 * the Project, so an edit that changed it in place would be an edit the screen
 * does not show. Keeping them out of the components is also what lets the rules
 * be read — and tested — without a Canvas.
 */

/** Replaces one Flow of a Project, leaving the others as they were. */
export function updateFlow(
  project: Project,
  flowId: string,
  change: (flow: Flow) => Flow
): Project {
  return {
    ...project,
    flows: project.flows.map(flow => (flow.id === flowId ? change(flow) : flow))
  }
}

/** Where a Node sits on the Canvas, after the user dragged it. */
export function moveNode(flow: Flow, nodeId: string, position: Position): Flow {
  return {
    ...flow,
    nodes: flow.nodes.map(node => (node.id === nodeId ? { ...node, position } : node))
  }
}

/**
 * The value the user typed into one of a Node's inline fields.
 *
 * A field can take Ports with it — renaming or removing a slash command
 * parameter removes the Port it was read from — so the Wires that Port carried
 * go at the same time. Leaving them would leave the Project holding Wires
 * pointing at nothing, which the Compiler refuses and the Canvas cannot draw.
 */
export function setNodeField(
  flow: Flow,
  catalogue: NodeCatalogue,
  nodeId: string,
  fieldId: string,
  value: FieldValue
): Flow {
  const edited: Flow = {
    ...flow,
    nodes: flow.nodes.map(node =>
      node.id === nodeId ? { ...node, fields: { ...node.fields, [fieldId]: value } } : node
    )
  }

  return pruneDanglingWires(edited, catalogue, nodeId)
}

/**
 * Draws a Wire. Whether it is allowed at all is decided before this is called,
 * by the Coercion table through `checkConnection`; this only records it.
 */
export function connectWire(
  flow: Flow,
  wire: { kind: WireKind; from: PortReference; to: PortReference }
): Flow {
  return { ...flow, wires: [...flow.wires, { id: nextWireId(flow), ...wire }] }
}

/** Removes a Wire. The Ports at both ends are free again. */
export function disconnectWire(flow: Flow, wireId: string): Flow {
  return { ...flow, wires: flow.wires.filter(wire => wire.id !== wireId) }
}

/**
 * The next free Wire id. It counts rather than randomises so that a saved
 * Project reads the way the user drew it, and so a test can name a Wire.
 */
function nextWireId(flow: Flow): string {
  const taken = new Set(flow.wires.map(wire => wire.id))
  let index = flow.wires.length + 1
  while (taken.has(`wire-${index}`)) index += 1
  return `wire-${index}`
}
