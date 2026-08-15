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

/**
 * Names a Project.
 *
 * A name that is blank is refused rather than written: a Project the user
 * cannot tell apart from any other is worse than the name they had before. The
 * name is trimmed, because the spaces around it are a typing accident and not
 * something the user meant to call their bot.
 */
export function renameProject(project: Project, name: string): Project {
  const trimmed = name.trim()
  if (trimmed.length === 0) return project
  return { ...project, name: trimmed }
}

/**
 * Why a rename was refused, or the Project it produced.
 *
 * A refusal says which rule it broke rather than handing back the Project
 * unchanged: the editor has to tell the user what to do about it, and "nothing
 * happened" is not something a screen can explain.
 */
export type FlowRename =
  | { renamed: true; project: Project }
  | { renamed: false; refusal: "empty" | "duplicate" }

/**
 * Names a Flow.
 *
 * Two Flows of one Project cannot share a name: the Flow list is how the user
 * tells them apart, and the export writes one file per Flow. A name already
 * taken is refused rather than quietly given a suffix — the user chose that
 * name, and a Project that renames things behind their back is one they stop
 * trusting. A blank name is refused for the same reason it is on a Project, and
 * because the schema would reject it on save.
 *
 * The Flow keeping its own name is not a duplicate: confirming the field
 * without changing anything is an accepted rename that leaves the Project as it
 * was apart from the trimming.
 */
export function renameFlow(project: Project, flowId: string, name: string): FlowRename {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { renamed: false, refusal: "empty" }

  const taken = project.flows.some(flow => flow.id !== flowId && flow.name === trimmed)
  if (taken) return { renamed: false, refusal: "duplicate" }

  return {
    renamed: true,
    project: updateFlow(project, flowId, flow => ({ ...flow, name: trimmed }))
  }
}

/**
 * Adds an empty Flow to a Project.
 *
 * `defaultName` is the same translated word the first Flow of a new Project is
 * given. It is numbered when the Project already has it, so creating a Flow
 * never lands on a name the user cannot keep — the rename this drops them into
 * would refuse it as a duplicate before they had typed anything. Which number
 * is free is read off the Project it is being added to, so two Flows made one
 * after the other are not both called the same thing.
 *
 * The id is the caller's, and the caller makes it a fresh UUID rather than a
 * count: Flows outlive the session that made them, and a Project opened beside
 * another must not hold a Flow answering to the same id as one of theirs. It is
 * passed in because the editor has to open the Flow it just made, and because
 * a function that invents its own id is one no test can pin down.
 */
export function createFlow(project: Project, id: string, defaultName: string): Project {
  const flow: Flow = { id, name: freeFlowName(project, defaultName), nodes: [], wires: [] }
  return { ...project, flows: [...project.flows, flow] }
}

/** `base`, or `base 2`, `base 3`… — the first of those no Flow is called. */
function freeFlowName(project: Project, base: string): string {
  const taken = new Set(project.flows.map(flow => flow.name))
  if (!taken.has(base)) return base

  let number = 2
  while (taken.has(`${base} ${number}`)) number += 1
  return `${base} ${number}`
}

/**
 * Why a removal was refused, or the Project it produced and the Flow the
 * Canvas shows next.
 *
 * Which Flow to open is answered here rather than in the editor: it is a rule
 * about the list, it is the part of removing a Flow the user notices most, and
 * a rule held inside a hook is one only a rendered Canvas can test.
 */
export type FlowRemoval =
  | { removed: true; project: Project; open: string }
  | { removed: false; refusal: "last" | "missing" }

/**
 * Whether this Project can spare a Flow at all.
 *
 * The refusal is the same rule `removeFlow` applies, exported so the list can
 * say why before asking a question it already knows the answer to — a modal
 * that only ever ends in "no" is a modal that should not have opened.
 */
export function canRemoveFlow(project: Project): boolean {
  return project.flows.length > 1
}

/**
 * Removes a Flow, and says which Flow the Canvas should show afterwards.
 *
 * The last Flow of a Project is never removed: the editor always has a Canvas
 * on screen, and a Project with no Flow is one the user cannot do anything with
 * — not even start again, since nothing would be there to add a Node to.
 *
 * `openFlowId` is the Flow the Canvas is showing. Removing some other Flow
 * leaves the user where they were. Removing the one they are looking at moves
 * them to its neighbour — the Flow above it, or the one below when it was the
 * first — because the work they were doing is next to that Flow in the list,
 * and jumping to the top of a long list loses their place for no reason.
 */
export function removeFlow(project: Project, flowId: string, openFlowId: string): FlowRemoval {
  const index = project.flows.findIndex(flow => flow.id === flowId)
  // Answered before the last-Flow rule, so a Flow that is not there is never
  // explained away as the only one the Project has.
  if (index === -1) return { removed: false, refusal: "missing" }
  if (!canRemoveFlow(project)) return { removed: false, refusal: "last" }

  const flows = project.flows.filter(flow => flow.id !== flowId)
  const neighbour = project.flows[index - 1] ?? project.flows[index + 1]

  return {
    removed: true,
    project: { ...project, flows },
    // `neighbour` is there whenever the removed Flow was not the only one, and
    // the fallback only keeps the type honest.
    open: flowId === openFlowId ? (neighbour?.id ?? "") : openFlowId
  }
}

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
