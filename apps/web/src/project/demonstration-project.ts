import type { Project } from "@bot-inventor/schema"
import { helloProject } from "@bot-inventor/schema/fixtures"

/**
 * A Project to look at when there is no file to open one from: `/hello` wired
 * to a reply, and a second, empty Flow beside it.
 *
 * The desktop application starts from an empty Project and opens `.botinv`
 * files. A plain browser can do neither, so this is what it shows there — see
 * `initial-project.ts`.
 *
 * The first Flow is the schema package's own `helloProject`, rather than a
 * second copy of the same Nodes: the end-to-end tests read this Canvas and the
 * unit tests read that fixture, and two copies would drift the first time a
 * Node changes. The second Flow is empty on purpose: it is there so the list
 * has two rows to choose between and two names that cannot be the same, which
 * is what the Flow list is for and what its specs read.
 */
export function demonstrationProject(): Project {
  const project = helloProject()
  return {
    ...project,
    flows: [...project.flows, { id: "flow-goodbye", name: "Goodbye", nodes: [], wires: [] }]
  }
}
