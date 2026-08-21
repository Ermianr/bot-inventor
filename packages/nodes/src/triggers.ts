import type { Flow } from "@bot-inventor/schema"

import type { NodeCatalogue } from "./catalogue.js"
import type { NodeDefinition } from "./definition.js"

/**
 * Whether a Flow has a Trigger, which is the same as asking whether it ever
 * runs: the Compiler emits a Flow by starting at its Trigger and following the
 * Execution Wires out of it, so a Flow with none emits nothing at all.
 *
 * It is read off the Flow every time rather than recorded on it. Dropping a
 * Trigger on the Canvas is what makes a Flow run, and a Project that also had
 * to remember it could be saved saying the opposite of what its Nodes say.
 *
 * A Node this build has no definition for is not counted: nothing can be said
 * about what it does, and claiming a Flow runs on the strength of a Node the
 * Compiler will refuse is the more misleading of the two answers.
 */
export function hasTrigger(flow: Flow, catalogue: NodeCatalogue): boolean {
  return flow.nodes.some(node => catalogue.get(node.type)?.isTrigger === true)
}

/**
 * One Node of the catalogue, as the list that offers it sees it: whether this
 * Flow can be given it, and — when it cannot — the words to write next to it.
 */
export type NodeChoice =
  | { definition: NodeDefinition; addable: true; refusalKey?: undefined }
  | { definition: NodeDefinition; addable: false; refusalKey: string }

/**
 * The whole catalogue, each Node answered for the Flow it would be added to.
 *
 * A Flow is the graph hanging off a single Trigger, so a Flow that has one is
 * never given another. The Trigger stays in the list rather than disappearing
 * from it: a Node that vanished would leave the user hunting for it, while one
 * shown with the reason beside it teaches the rule the first time they look.
 *
 * The answer is given here rather than worked out by the list, so the rule can
 * be read and tested without a screen. The Compiler refuses a two-Trigger Flow
 * as well, and stays the backstop: a Project can arrive holding one from a hand
 * edit, and this only decides what the editor offers.
 */
export function addableNodes(flow: Flow, catalogue: NodeCatalogue): NodeChoice[] {
  const taken = hasTrigger(flow, catalogue)

  return [...catalogue.values()].map(definition =>
    taken && definition.isTrigger
      ? { definition, addable: false, refusalKey: "catalogue.rejected.triggerTaken" }
      : { definition, addable: true }
  )
}
