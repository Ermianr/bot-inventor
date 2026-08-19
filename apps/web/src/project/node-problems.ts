import { catalogue, type NodeProblem } from "@bot-inventor/nodes"
import type { Project } from "@bot-inventor/schema"
import { translateDefinitionKey } from "@/i18n/messages"

/**
 * What the Nodes of a Project say is wrong with what was typed into them.
 *
 * A Node answers for itself — the Embed Node is the first that does — and the
 * editor asks the same question in two places: on the Canvas, where the Node
 * draws its own problems, and here, before a Run starts. The Run is what makes
 * it matter: a bot the editor already knows Discord would refuse is not worth
 * putting in front of the user as a live bot to debug.
 */
export function projectProblems(project: Project): readonly NodeProblem[] {
  return project.flows.flatMap(flow =>
    flow.nodes.flatMap(node => catalogue.get(node.type)?.problems?.(node.fields) ?? [])
  )
}

/**
 * The first thing wrong with a Project, in the user's own language, or nothing
 * when there is nothing to say. One is enough to refuse the Run, and the Node
 * on the Canvas is where the rest of them are read.
 */
export function describeProjectProblem(project: Project): string | undefined {
  const [problem] = projectProblems(project)
  if (problem === undefined) return undefined
  return translateDefinitionKey(problem.messageKey, problem.values)
}
