import type { OpenProjectResult, Project } from "@bot-inventor/schema"
import { useEffect, useRef, useState } from "react"

import { translate } from "@/i18n/messages"
import { describeError } from "@/project/describe-error"
import { type ProjectStore, readStoredProject, serializeProject } from "@/project/project-store"

/**
 * Getting a Project out of storage and keeping it there.
 *
 * The two halves are separate hooks because they answer different questions.
 * Loading answers "is there a Project here at all", which the route has to know
 * before it can render an editor; autosave answers "is what is on the Canvas
 * what is in storage", which only exists once there is an editor.
 */

/** A Project on its way onto the Canvas. */
export type LoadedProject =
  | { status: "loading" }
  | { status: "problem"; message: string }
  | {
      status: "loaded"
      project: Project
      /**
       * Whether it had to be brought up to this build's format on the way in.
       * The Project is only in the new format in memory until something writes
       * it, so this is what tells autosave it has one to do.
       */
      migrated: boolean
    }

/**
 * Reads the Project a route is pointing at.
 *
 * A Project this build cannot read is a message rather than a blank screen: it
 * is the user's Project and they are owed the reason, which is the whole point
 * of `readStoredProject` returning an outcome instead of throwing.
 */
export function useStoredProject(store: ProjectStore, projectId: string): LoadedProject {
  const [loaded, setLoaded] = useState<LoadedProject>({ status: "loading" })

  useEffect(() => {
    let current = true
    setLoaded({ status: "loading" })

    void (async () => {
      let result: OpenProjectResult
      try {
        result = await readStoredProject(store, projectId)
      } catch (error) {
        if (current) {
          setLoaded({
            status: "problem",
            message: translate("project.problem.read", { message: describeError(error) })
          })
        }
        return
      }
      if (!current) return

      if (result.status !== "opened") {
        setLoaded({ status: "problem", message: explain(result) })
        return
      }

      setLoaded({ status: "loaded", project: result.project, migrated: result.migrated })
    })()

    return () => {
      current = false
    }
  }, [store, projectId])

  return loaded
}

/**
 * How long an edit waits before it is written.
 *
 * It is a pause, not a throttle: every edit pushes it back, so typing a name
 * writes once, when the typing stops, rather than once per letter. Short enough
 * that a user who closes the window straight after an edit still keeps it.
 */
export const AUTOSAVE_DELAY = 300

/** Whether the Canvas is in storage, and why it is not when it is not. */
export type Autosave = {
  /** Whether everything on the Canvas has reached the store. */
  saved: boolean
  /** Why the last write did not happen, when it did not. */
  problem: string | undefined
}

/**
 * Keeps storage holding what the Canvas holds, without anybody pressing
 * anything.
 *
 * The Project as it was loaded is what the first comparison is made against, so
 * opening a Project does not immediately write it back: a write nobody asked
 * for would move every Project to the top of the Dashboard the moment it was
 * looked at.
 *
 * A write that fails is said out loud rather than retried. Retrying a disk that
 * will not take a write produces a user who is told nothing while losing
 * everything, and the one thing autosave owes them in exchange for taking Save
 * away is the truth about whether their work is safe.
 */
export function useAutosave(
  store: ProjectStore,
  project: Project,
  options: { migrated?: boolean } = {}
): Autosave {
  const document = serializeProject(project)
  // A migrated Project is in this build's format in memory only, so it counts
  // as an edit from the moment it is loaded: the write is what makes the
  // migration stick, and the backup taken on the way in is what makes that safe.
  const [savedDocument, setSavedDocument] = useState(options.migrated === true ? "" : document)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  // Read through a ref so that the timer is only ever restarted by an edit, and
  // never by a store that was rebuilt on a render.
  const latest = useRef({ store, project })
  latest.current = { store, project }

  useEffect(() => {
    if (document === savedDocument) return

    const timer = setTimeout(() => {
      void (async () => {
        // Taken before the write rather than after it: an edit made while the
        // write is under way is still owed one of its own, and reading the
        // Canvas afterwards would count that edit as already stored.
        const writing = { ...latest.current.project }
        try {
          await latest.current.store.write(writing)
        } catch (error) {
          setProblem(translate("project.problem.write", { message: describeError(error) }))
          return
        }
        setSavedDocument(serializeProject(writing))
        setProblem(undefined)
      })()
    }, AUTOSAVE_DELAY)

    return () => clearTimeout(timer)
  }, [document, savedDocument])

  return { saved: document === savedDocument, problem }
}

/** What the user is told about a Project this build would not open. */
function explain(result: Exclude<OpenProjectResult, { status: "opened" }>): string {
  switch (result.status) {
    case "future-version":
      return translate("project.problem.futureVersion")
    case "migration-failed":
      return translate("project.problem.migrationFailed", { message: result.message })
    default:
      return translate("project.problem.malformed")
  }
}
