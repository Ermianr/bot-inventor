import {
  checkConnection,
  defaultFieldValue,
  type NodeCatalogue,
  type NodeDefinition,
  pruneDanglingWires,
  slotPortId
} from "@bot-inventor/nodes"
import type {
  FieldValue,
  Flow,
  Node,
  PortReference,
  Position,
  Project,
  WireKind
} from "@bot-inventor/schema"
import { type Caret, editableText, slottedTextOf, withSlotInserted } from "@/project/editable-text"
import { fieldWithSlottedTextAt, readFieldPath, slottedTextAt } from "@/project/field-path"

/**
 * Every change the Canvas makes to a Project, as pure functions.
 *
 * They return a new Project rather than mutating one: the editor renders from
 * the Project, so an edit that changed it in place would be an edit the screen
 * does not show. Keeping them out of the components is also what lets the rules
 * be read — and tested — without a Canvas.
 */

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

/**
 * Puts a Node of the catalogue on the Canvas, where the user asked for it.
 *
 * Its fields start at the definition's own defaults rather than empty, so a
 * Node the user has not touched yet is one the Compiler can already emit — the
 * Reply Node arrives with its "only they can see it" answered, not undecided.
 *
 * The definition is passed rather than looked up from a catalogue and an id: a
 * Node type this build does not have is not something the user can pick, so
 * there is no failure here for a caller to handle.
 */
export function addNode(flow: Flow, definition: NodeDefinition, position: Position): Flow {
  const fields: Node["fields"] = {}
  for (const field of definition.fields) fields[field.id] = defaultFieldValue(field)

  const node: Node = { id: nextNodeId(flow), type: definition.id, position, fields }
  return { ...flow, nodes: [...flow.nodes, node] }
}

/**
 * The first free Node id. It counts rather than randomises for the same reason
 * a Wire id does: a saved Project reads the way the user built it, and a test
 * can name the Node it just added. The count starts at one and steps over what
 * is taken, so a Flow whose Nodes were named by hand — or by a Project the user
 * opened — never has its ids collide with the ones added on the Canvas.
 */
function nextNodeId(flow: Flow): string {
  const taken = new Set(flow.nodes.map(node => node.id))
  let index = 1
  while (taken.has(`node-${index}`)) index += 1
  return `node-${index}`
}

/**
 * Takes a Node off the Canvas, and its Wires with it.
 *
 * A Wire with either end on the Node goes at the same time: a Project holding a
 * Wire that points at a Node that is gone is one the Compiler refuses and the
 * Canvas cannot draw, so leaving them would break the Project rather than edit
 * it. Everything else in the Flow is left exactly as it was.
 *
 * A Trigger is removed like anything else. Refusing would trap the user with
 * the Trigger they happened to pick first and no way to change their mind.
 */
export function removeNode(flow: Flow, nodeId: string): Flow {
  return {
    ...flow,
    nodes: flow.nodes.filter(node => node.id !== nodeId),
    wires: flow.wires.filter(wire => wire.from.node !== nodeId && wire.to.node !== nodeId)
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
 * parameter, or typing over the last occurrence of a Slot, removes the Port it
 * was read from (ADR 0010) — so the Wires that Port carried
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
 * Why dropping a Wire on a text field was refused, or the Project it produced.
 *
 * A refusal names the rule it broke, the same way a Wire refused at a Port
 * does: the user made one gesture and it was turned down, and which gesture it
 * was must not change whether they are told why.
 */
export type SlotInsertion = { inserted: true; flow: Flow } | { inserted: false; reasonKey: string }

/**
 * Drops a Wire onto a text field: a Slot appears at the caret, and the Wire
 * arrives at the Port that Slot declares.
 *
 * The two are one edit. A Slot with no Wire is a hole the user never asked for,
 * and a Wire with no Slot cannot exist at all — the Port it would arrive at is
 * the field's to declare (ADR 0010) — so a refusal leaves the Flow untouched
 * rather than half of each.
 *
 * Whether the Wire is allowed is asked of `checkConnection` on the Flow the
 * Slot is already in, so the Port it names is there to be found and the answer
 * comes from the same Coercion table every other Wire is judged by. A Slot's
 * Port takes text, so a value with no Coercion to text — an Embed — is refused
 * here in the words the Canvas already uses for it.
 *
 * The Slot's id is the caller's, for the same reason a Flow's is: it is opaque
 * and it outlives the session, and a function that invents its own is one no
 * test can pin down.
 *
 * `at.field` is where the text lives rather than a field id: the name and the
 * value of an Embed Field are text a Wire drops into just as much as a field of
 * its own is, and they are addressed by `readFieldPath`.
 */
export function insertSlot(
  flow: Flow,
  catalogue: NodeCatalogue,
  at: { node: string; field: string; caret: Caret },
  from: PortReference,
  slot: string
): SlotInsertion {
  const node = flow.nodes.find(candidate => candidate.id === at.node)
  if (node === undefined) return { inserted: false, reasonKey: "connections.rejected.unknownPort" }

  // `at.field` addresses a piece of Slotted text, which is a field of its own
  // or one half of an Embed Field. Either way what is written back is the whole
  // field, because a field is what a Project stores.
  const path = readFieldPath(at.field)
  const editable = editableText(slottedTextAt(node.fields, path))
  const segments = slottedTextOf(withSlotInserted(editable, at.caret, slot))
  const value = fieldWithSlottedTextAt(node.fields, path, segments)
  const slotted = setNodeField(flow, catalogue, at.node, path.field, value)

  const to: PortReference = { node: at.node, port: slotPortId(slot) }
  const check = checkConnection({ flow: slotted, catalogue, from, to })
  if (!check.legal) return { inserted: false, reasonKey: check.reasonKey }

  return { inserted: true, flow: connectWire(slotted, { kind: check.kind, from, to }) }
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
