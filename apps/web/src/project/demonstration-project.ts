import type { Project } from "@bot-inventor/schema"
import { helloProject } from "@bot-inventor/schema/fixtures"

/**
 * A Project to look at when there is no file to open one from: one Flow,
 * `/hello`, wired to a reply.
 *
 * The desktop application starts from an empty Project and opens `.botinv`
 * files. A plain browser can do neither, so this is what it shows there — see
 * `initial-project.ts`.
 *
 * It is the schema package's own `helloProject`, rather than a second copy of
 * the same Nodes: the end-to-end tests read this Canvas and the unit tests read
 * that fixture, and two copies would drift the first time a Node changes.
 */
export function demonstrationProject(): Project {
  return helloProject()
}
