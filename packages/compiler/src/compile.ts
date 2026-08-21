import {
  type CompilerMode,
  catalogue as defaultCatalogue,
  type NodeCatalogue
} from "@bot-inventor/nodes"
import type { Project } from "@bot-inventor/schema"

import { compileFlow } from "./compile-flow.js"
import { renderModule } from "./module.js"

export type CompileOptions = {
  mode: CompilerMode
  /** Overridable so a test can compile against a catalogue of its own. */
  catalogue?: NodeCatalogue
}

export type CompiledProject = {
  mode: CompilerMode
  /**
   * The body of the generated `defineBot(runtime)`: registrations only, with no
   * imports. It is what the test seam evaluates.
   */
  program: string
  /** The complete ES module, ready to be written to disk by an Export. */
  source: string
}

/**
 * Turns a validated Project into JavaScript. Only what is reachable from a
 * Trigger is emitted: a Node left unwired on the Canvas leaves no trace in the
 * result.
 */
export function compile(project: Project, options: CompileOptions): CompiledProject {
  const catalogue = options.catalogue ?? defaultCatalogue
  const program = project.flows
    .map(flow => compileFlow(flow, catalogue, options.mode))
    .filter(emitted => emitted.length > 0)
    .join("\n\n")

  return {
    mode: options.mode,
    program,
    source: renderModule(program, options.mode)
  }
}
