import type { Flow } from "@bot-inventor/schema"
import type { NodeCatalogue } from "./catalogue.js"

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
