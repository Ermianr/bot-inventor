import { CURRENT_SCHEMA_VERSION, type Project } from "@bot-inventor/schema"
import { translate } from "@/i18n/messages"

/**
 * The empty Project the user is given when they start, and every time they ask
 * for a new one: one empty Flow, on an empty Canvas.
 *
 * Its id is fresh on purpose. A Project's Secret is keyed by that id in the
 * keychain, so two Projects that shared an id would share a bot token.
 *
 * The name and the Flow's name are translated when the Project is made, because
 * from that moment they are the user's text, saved in their file and theirs to
 * change — unlike everything else the user reads, which is resolved every time
 * it is drawn.
 */
export function newProject(): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `project-${crypto.randomUUID()}`,
    name: translate("project.untitled"),
    flows: [
      {
        id: `flow-${crypto.randomUUID()}`,
        name: translate("project.flow.default"),
        nodes: [],
        wires: []
      }
    ]
  }
}
