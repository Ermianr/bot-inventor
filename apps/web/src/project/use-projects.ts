import type { Project } from "@bot-inventor/schema"
import { useCallback, useEffect, useState } from "react"

import { translate } from "@/i18n/messages"
import { demonstrationProject } from "@/project/demonstration-project"
import { describeError } from "@/project/describe-error"
import { newProject } from "@/project/new-project"
import { listProjects, type ProjectStore, type ProjectSummary } from "@/project/project-store"

/**
 * What the Dashboard is: the Projects the application holds, and making another
 * one.
 *
 * Creating hands back the id it made rather than navigating itself. Where the
 * user goes next is the route's business, and a hook that navigated could not
 * be driven by a test that has no router.
 */

/** Everything the user is asked for when a Project is made. */
export type ProjectDetails = {
  name: string
  secret: string
  testServerId: string
}

export type Projects = {
  /** The Projects, or nothing at all while the store is still being read. */
  projects: readonly ProjectSummary[] | undefined
  /** Why the last thing the user asked for did not happen, when it did not. */
  problem: string | undefined
  /** The id of the Project that was made, or nothing when it was not. */
  create(details: ProjectDetails): Promise<string | undefined>
  /** Makes the demonstration Project, for a Dashboard with nothing on it. */
  createExample(): Promise<string | undefined>
}

export function useProjects(store: ProjectStore): Projects {
  const [projects, setProjects] = useState<readonly ProjectSummary[] | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects(store))
    } catch (error) {
      setProjects([])
      setProblem(translate("dashboard.problem.list", { message: describeError(error) }))
    }
  }, [store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Puts a Project in storage and says which one it is.
   *
   * The list is refreshed from the store rather than added to in memory: the
   * store is the only thing that knows what is there, and a Dashboard that drew
   * a card for a Project the store never took would be lying to the user about
   * work they still have.
   */
  const put = useCallback(
    async (project: Project, secret: string, testServerId: string) => {
      setProblem(undefined)
      try {
        await store.create(project, { secret, testServerId })
      } catch (error) {
        setProblem(translate("dashboard.problem.create", { message: describeError(error) }))
        return undefined
      }
      await refresh()
      return project.id
    },
    [store, refresh]
  )

  return {
    projects,
    problem,

    /**
     * A Project without a token is one whose Run button is dead the moment it
     * opens, so it is refused here as well as in the dialog: the rule belongs
     * with the Project, not with the field the user typed into.
     */
    create: useCallback(
      async details => {
        if (details.secret.trim().length === 0) {
          setProblem(translate("dashboard.create.tokenRequired"))
          return undefined
        }
        return put(
          { ...newProject(), name: details.name.trim() || translate("project.untitled") },
          details.secret.trim(),
          details.testServerId.trim()
        )
      },
      [put]
    ),

    /**
     * The example is a Project of the user's own, not a read-only tour: it is
     * theirs to take apart, which is the only way somebody who has never built
     * a bot finds out what the Nodes do. It arrives without a token, because
     * nobody is being asked for one to look at something.
     */
    createExample: useCallback(
      () => put({ ...demonstrationProject(), id: newProject().id }, "", ""),
      [put]
    )
  }
}
