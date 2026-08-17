import type { Project } from "@bot-inventor/schema"
import { useCallback, useState } from "react"

import { translate } from "@/i18n/messages"
import { describeError } from "@/project/describe-error"
import { serializeProject } from "@/project/project-store"
import { type ShareGateway, suggestedFileName } from "@/project/share-gateway"

/**
 * Handing the Project to somebody else: one Project File, somewhere the user
 * picked, holding the Project and nothing else.
 *
 * There is no question in it beyond where it goes — the save dialog answers
 * replacing a file that is already there — so what the editor is owed back is
 * only where it went, and why when it did not.
 */
export type Sharing = {
  /** Where the Project was last shared to, in words, until it is shared again. */
  written: string | undefined
  /** Why the last Share did not happen, when it did not. */
  problem: string | undefined
  /**
   * Whether one is going on, from the dialog opening to the file being on disk.
   *
   * It is not about how long a write takes — it is one document — but about
   * being asked twice: a second Share started over the first would open a second
   * dialog and race the first one's write to whatever path came back.
   */
  busy: boolean
  share(): Promise<void>
}

export function useShare(project: Project, shares: ShareGateway): Sharing {
  const [written, setWritten] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const share = useCallback(async () => {
    setWritten(undefined)
    setProblem(undefined)
    setBusy(true)

    try {
      const path = await shares.chooseDestination(suggestedFileName(project.name))
      // The user closed the dialog. Nothing was asked for, so nothing is said.
      if (path === undefined) return

      // The document, written exactly as storage writes it: a Project File and
      // the Project's own file in storage are the same document, and anything
      // that made them differ would be a second format to migrate.
      await shares.write(path, serializeProject(project))
      setWritten(translate("share.written", { path }))
    } catch (error) {
      setProblem(translate("share.problem.failed", { message: describeError(error) }))
    } finally {
      setBusy(false)
    }
  }, [project, shares])

  return { written, problem, busy, share }
}
