import type { Project } from "@bot-inventor/schema"
import { useCallback, useEffect, useState } from "react"

import { translate } from "@/i18n/messages"
import { demonstrationProject } from "@/project/demonstration-project"
import { describeError } from "@/project/describe-error"
import { newProject } from "@/project/new-project"
import {
  listProjects,
  type ProjectStore,
  type ProjectSummary,
  readStoredProject
} from "@/project/project-store"
import { explainOpenProblem } from "@/project/use-stored-project"

/**
 * What the Dashboard is: the Projects the application holds, making another
 * one, and managing the ones that are there.
 *
 * Creating hands back the id it made rather than navigating itself. Where the
 * user goes next is the route's business, and a hook that navigated could not
 * be driven by a test that has no router.
 *
 * Renaming, duplicating and deleting live here rather than on the card because
 * each of them ends with the list being read again: what is on the Dashboard is
 * whatever the store says is there, never what this hook believes it did.
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
  /**
   * Why the Projects could not be listed, when they could not.
   *
   * It is kept apart from `creationProblem` because the two are read in two
   * different places: this one belongs to the screen, that one to the dialog.
   * One string for both would show a disk that would not answer as the reason
   * the name the user just typed was refused.
   */
  problem: string | undefined
  /** Why the last attempt did not make a Project, when it did not. */
  creationProblem: string | undefined
  /**
   * Why the last thing asked of one Project did not happen, and which Project
   * it was asked of.
   *
   * The id travels with the message because there are as many places to say
   * this as there are cards: a rename that failed belongs in the rename dialog
   * for that Project, not on the screen and not on somebody else's card.
   */
  manageProblem: ManageProblem | undefined
  /** The id of the Project that was made, or nothing when it was not. */
  create(details: ProjectDetails): Promise<string | undefined>
  /** Makes the demonstration Project, for a Dashboard with nothing on it. */
  createExample(): Promise<string | undefined>
  /** Changes what a Project is called, in the list and in the document. */
  rename(projectId: string, name: string): Promise<boolean>
  /** Copies a Project, untokened, and says which one the copy is. */
  duplicate(projectId: string): Promise<string | undefined>
  /** Takes a Project, its Secret and its local settings out of storage. */
  remove(projectId: string): Promise<boolean>
}

/** Why something asked of one Project did not happen. */
export type ManageProblem = {
  projectId: string
  message: string
}

export function useProjects(store: ProjectStore): Projects {
  const [projects, setProjects] = useState<readonly ProjectSummary[] | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [creationProblem, setCreationProblem] = useState<string | undefined>(undefined)
  const [manageProblem, setManageProblem] = useState<ManageProblem | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects(store))
      setProblem(undefined)
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
      // Dropped before the next attempt, so that a refusal repeating word for
      // word is still an event the dialog can show rather than a message that
      // never changed.
      setCreationProblem(undefined)
      try {
        await store.create(project, { secret, testServerId })
      } catch (error) {
        setCreationProblem(translate("dashboard.problem.create", { message: describeError(error) }))
        return undefined
      }
      await refresh()
      return project.id
    },
    [store, refresh]
  )

  /**
   * The Project behind a card, or nothing and a reason on that card.
   *
   * Renaming and duplicating both have to open the document first, and both owe
   * the user the same answer when this build cannot read it: the words the
   * editor would have used, rather than a rename that silently did nothing.
   */
  const documentOf = useCallback(
    async (projectId: string, failure: "rename" | "duplicate") => {
      try {
        const result = await readStoredProject(store, projectId)
        if (result.status === "opened") return result.project
        setManageProblem({
          projectId,
          message: translate(`dashboard.problem.${failure}`, {
            message: explainOpenProblem(result)
          })
        })
      } catch (error) {
        setManageProblem({
          projectId,
          message: translate(`dashboard.problem.${failure}`, { message: describeError(error) })
        })
      }
      return undefined
    },
    [store]
  )

  return {
    projects,
    problem,
    creationProblem,
    manageProblem,

    /**
     * A Project without a token is one whose Run button is dead the moment it
     * opens, so it is refused here as well as in the dialog: the rule belongs
     * with the Project, not with the field the user typed into.
     */
    create: useCallback(
      async details => {
        if (details.secret.trim().length === 0) {
          setCreationProblem(translate("dashboard.create.tokenRequired"))
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
    ),

    /**
     * Renaming is the Dashboard's alone: a Project is renamed among the others,
     * where the name is what tells them apart, and nowhere else.
     *
     * A blank name is refused rather than stored, for the same reason a blank
     * Flow name is: a card the user cannot tell from the one beside it.
     */
    rename: useCallback(
      async (projectId, name) => {
        setManageProblem(undefined)
        const wanted = name.trim()
        if (wanted.length === 0) {
          setManageProblem({
            projectId,
            message: translate("dashboard.rename.nameRequired")
          })
          return false
        }

        const project = await documentOf(projectId, "rename")
        if (project === undefined) return false

        try {
          await store.write({ ...project, name: wanted })
        } catch (error) {
          setManageProblem({
            projectId,
            message: translate("dashboard.problem.rename", { message: describeError(error) })
          })
          return false
        }
        await refresh()
        return true
      },
      [store, refresh, documentOf]
    ),

    /**
     * A copy the user can take apart without endangering the one that works.
     *
     * It is a Project of its own from the first moment: a fresh id, so that
     * editing it never reaches the original, and — because a Secret is keyed by
     * that id — no token at all. Two Projects running as the same Discord
     * account is the accident this prevents, and the copy asks for a token of
     * its own the first time it is run.
     *
     * The Test Server comes across. It is not a Secret, it belongs to this
     * machine rather than to the bot, and it is where the user was going to
     * test the copy anyway.
     */
    duplicate: useCallback(
      async projectId => {
        setManageProblem(undefined)
        const project = await documentOf(projectId, "duplicate")
        if (project === undefined) return undefined

        let testServerId = ""
        try {
          testServerId = await store.readTestServer(projectId)
        } catch {
          // A setting is not worth refusing a copy over: the duplicate arrives
          // without a Test Server and the user picks one, which is what they
          // would have done had the original never had one.
        }

        const copy: Project = {
          ...project,
          id: newProject().id,
          name: translate("dashboard.duplicate.name", { name: project.name })
        }

        try {
          await store.create(copy, { secret: "", testServerId })
        } catch (error) {
          setManageProblem({
            projectId,
            message: translate("dashboard.problem.duplicate", { message: describeError(error) })
          })
          return undefined
        }
        await refresh()
        return copy.id
      },
      [store, refresh, documentOf]
    ),

    /**
     * Deleting takes everything with it, and the store is what decides in which
     * order. What is decided here is only that the Dashboard is read again
     * afterwards: a card that stayed because a delete half-happened is a card
     * the user is entitled to see and try again.
     */
    remove: useCallback(
      async projectId => {
        setManageProblem(undefined)
        try {
          await store.remove(projectId)
        } catch (error) {
          setManageProblem({
            projectId,
            message: translate("dashboard.problem.delete", { message: describeError(error) })
          })
          await refresh()
          return false
        }
        await refresh()
        return true
      },
      [store, refresh]
    )
  }
}
