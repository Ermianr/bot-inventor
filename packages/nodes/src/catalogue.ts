import type { NodeDefinition } from "./definition.js"
import { reply } from "./discord/reply.js"
import { slashCommandTrigger } from "./discord/slash-command-trigger.js"

/** Every Node the editor offers and the Compiler knows how to emit. */
export type NodeCatalogue = ReadonlyMap<string, NodeDefinition>

const definitions: readonly NodeDefinition[] = [slashCommandTrigger, reply]

export const catalogue: NodeCatalogue = buildCatalogue(definitions)

/**
 * Builds a catalogue from a list of Node definitions, refusing two Nodes that
 * claim the same id — a collision would silently change what saved Projects mean.
 */
export function buildCatalogue(nodeDefinitions: readonly NodeDefinition[]): NodeCatalogue {
  const byId = new Map<string, NodeDefinition>()
  for (const definition of nodeDefinitions) {
    if (byId.has(definition.id)) {
      throw new Error(`two Nodes claim the id "${definition.id}"`)
    }
    byId.set(definition.id, definition)
  }
  return byId
}
