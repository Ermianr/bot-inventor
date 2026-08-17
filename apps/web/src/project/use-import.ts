import type { Project } from "@bot-inventor/schema"
import { useCallback, useState } from "react"

import { translate } from "@/i18n/messages"
import { describeError } from "@/project/describe-error"
import { type ImportGateway, readProjectFile } from "@/project/import-gateway"
import { explainOpenProblem } from "@/project/use-stored-project"

/**
 * Taking in a Project somebody sent: the file, and what was in it.
 *
 * This is only the first half of an import. What comes back is a Project that
 * is not in storage yet and has nothing that would let it run — the token and
 * the Test Server are still to be asked for, in the same dialog creating a
 * Project asks them in, because what is being made is this user's bot on this
 * user's server. Making it is `useProjects`.
 *
 * The two halves are apart because they fail at different people: a file that
 * cannot be read is refused before anything is asked, and a store that will not
 * take the Project is refused in the dialog that did the asking.
 */
export type Importing = {
  /** Why the last import did not get that far, when it did not. */
  problem: string | undefined
  /**
   * Whether one is going on, from the dialog opening to the document being
   * read. Two open dialogs at once are two imports racing to be the one the
   * user is asked about, and the loser vanishes without ever being seen.
   */
  busy: boolean
  /**
   * The Project in the file the user picked, or nothing when they picked none
   * and when what they picked was not one.
   *
   * It is handed back rather than kept because the Dashboard is what does the
   * asking next, the same way creating hands back an id rather than navigating.
   */
  choose(): Promise<Project | undefined>
  /** Forgets the refusal, for when the user has been told and moved on. */
  forgetProblem(): void
}

export function useImport(imports: ImportGateway): Importing {
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const choose = useCallback(async () => {
    setProblem(undefined)
    setBusy(true)

    try {
      const path = await imports.chooseSource()
      // The user closed the dialog. Nothing was asked for, so nothing is said.
      if (path === undefined) return undefined

      const result = await readProjectFile(await imports.read(path))
      if (result.status === "opened") return result.project

      // The same words the editor refuses a Project of the user's own in. What
      // is wrong with a document does not depend on where it came from, and a
      // second vocabulary for it would only be a second thing to translate.
      setProblem(explainOpenProblem(result))
      return undefined
    } catch (error) {
      setProblem(translate("import.problem.read", { message: describeError(error) }))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [imports])

  return {
    problem,
    busy,
    choose,
    forgetProblem: useCallback(() => setProblem(undefined), [])
  }
}
