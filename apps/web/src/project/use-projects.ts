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
   * Forgets that refusal, for when the dialog holding it is put away.
   *
   * A reason outlives the attempt it was about unless somebody says otherwise,
   * and the next thing the user opens is a dialog with empty fields: a red line
   * under them about a Project they are no longer making is the application
   * refusing something nobody has asked for yet.
   */
  forgetCreationProblem(): void
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
  createExample(details: ProjectDetails): Promise<string | undefined>
  /**
   * Makes a Project of the user's own out of one somebody sent, and says which
   * one it is.
   *
   * It takes the Project rather than the file: reading a Project File is
   * `useImport`'s, and by the time this is called the questions the file cannot
   * answer have been asked.
   */
  importProject(incoming: Project, details: ProjectDetails): Promise<string | undefined>
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

/**
 * The three things a user does to a Project without opening it.
 *
 * They are named the same here, in the card's menu and in the message keys that
 * explain them, so that adding a fourth is one list rather than four.
 */
export type ManageAction = "rename" | "duplicate" | "delete"

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

  // Awaited rather than called and forgotten, so that what the store answers is
  // written down after the render that asked rather than during it.
  useEffect(() => {
    void (async () => {
      await refresh()
    })()
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
   * Says why one thing asked of one Project did not happen.
   *
   * All three actions refuse the same shape — which Project, which action, and
   * the reason underneath — so the sentence is assembled once. What differs is
   * only the action, and the action is what picks the words.
   */
  const refuse = useCallback((projectId: string, action: ManageAction, reason: string) => {
    setManageProblem({
      projectId,
      message: translate(`dashboard.problem.${action}`, { message: reason })
    })
  }, [])

  /**
   * The Project behind a card, or nothing and a reason on that card.
   *
   * Renaming and duplicating both have to open the document first, and both owe
   * the user the same answer when this build cannot read it: the words the
   * editor would have used, rather than a rename that silently did nothing.
   */
  const documentOf = useCallback(
    async (projectId: string, action: ManageAction) => {
      try {
        const result = await readStoredProject(store, projectId)
        if (result.status === "opened") return result.project
        refuse(projectId, action, explainOpenProblem(result))
      } catch (error) {
        refuse(projectId, action, describeError(error))
      }
      return undefined
    },
    [store, refuse]
  )

  /**
   * Makes a Project out of what the user was asked for, whatever was on the
   * Canvas to begin with.
   *
   * A Project without a token is one whose Run button is dead the moment it
   * opens, so it is refused here as well as in the dialog: the rule belongs
   * with the Project, not with the field the user typed into. The example goes
   * through the same door for the same reason — it is a Project of the user's
   * own, so it is a Project of the user's own in every respect, including the
   * one that decides whether it can run.
   */
  const make = useCallback(
    (canvas: Project, details: ProjectDetails) => {
      if (details.secret.trim().length === 0) {
        setCreationProblem(translate("dashboard.create.tokenRequired"))
        return Promise.resolve(undefined)
      }
      return put(
        { ...canvas, name: details.name.trim() || translate("project.untitled") },
        details.secret.trim(),
        details.testServerId.trim()
      )
    },
    [put]
  )

  return {
    projects,
    problem,
    creationProblem,
    manageProblem,
    forgetCreationProblem: useCallback(() => setCreationProblem(undefined), []),

    create: useCallback(details => make(newProject(), details), [make]),

    /**
     * The example is a Project of the user's own, not a read-only tour: it is
     * theirs to take apart, which is the only way somebody who has never built
     * a bot finds out what the Nodes do. A fresh id every time, so that asking
     * for it twice gives two Projects rather than one overwritten.
     */
    createExample: useCallback(
      details => make({ ...demonstrationProject(), id: newProject().id }, details),
      [make]
    ),

    /**
     * A Project somebody sent becomes a Project of this user's own, and one
     * that has never been here before.
     *
     * The id in the file is dropped for a fresh one, which is what makes an
     * import a copy rather than a landing place: the same file taken in twice
     * gives two Projects instead of one overwriting the other, and a Project
     * that came from one of the user's own — sent to a friend and sent back —
     * never reaches the original. The id is also what a Secret is keyed by, so
     * an id that travelled would be two Projects sharing a bot token.
     *
     * The document is otherwise untouched: what was built is what arrives.
     */
    importProject: useCallback(
      (incoming, details) => make({ ...incoming, id: newProject().id }, details),
      [make]
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
          refuse(projectId, "rename", describeError(error))
          return false
        }
        await refresh()
        return true
      },
      [store, refresh, documentOf, refuse]
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
          refuse(projectId, "duplicate", describeError(error))
          return undefined
        }
        await refresh()
        return copy.id
      },
      [store, refresh, documentOf, refuse]
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
          refuse(projectId, "delete", describeError(error))
          await refresh()
          return false
        }
        await refresh()
        return true
      },
      [store, refresh, refuse]
    )
  }
}
