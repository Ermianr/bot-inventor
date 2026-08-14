import type { OpenProjectResult } from "@bot-inventor/schema"
import { useCallback, useState } from "react"

import { translate } from "@/i18n/messages"
import { newProject } from "@/project/new-project"
import {
  describeError,
  type ProjectFileGateway,
  readProjectFile,
  serializeProject,
  suggestedFileName,
  writeProjectFile
} from "@/project/project-file"
import type { ProjectEditor } from "@/project/use-project"

/**
 * The Project's life as a file: which one is open, whether it holds everything
 * the user has done, and the four things they can ask for.
 *
 * What makes work survive is that nothing here is silent. Changes are never
 * thrown away without the user agreeing to it, and a file this build cannot
 * read is explained rather than rewritten.
 */
export type ProjectFileEditor = {
  /** Where the open Project lives, or `undefined` while it has never been saved. */
  path: string | undefined
  /** Whether the file on disk holds everything on the Canvas. */
  saved: boolean
  /** Why the last thing the user asked for did not happen, when it did not. */
  problem: string | undefined
  create(): Promise<void>
  open(): Promise<void>
  save(): Promise<void>
  saveAs(): Promise<void>
  /**
   * Whether the editor may be closed: true when nothing would be lost, and
   * otherwise whatever the user answers.
   */
  confirmDiscard(): Promise<boolean>
}

export function useProjectFile(
  editor: ProjectEditor,
  files: ProjectFileGateway
): ProjectFileEditor {
  const [path, setPath] = useState<string | undefined>(undefined)
  /** The Project as the file holds it: what "saved" is measured against. */
  const [savedDocument, setSavedDocument] = useState(() => serializeProject(editor.project))
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const saved = serializeProject(editor.project) === savedDocument

  /**
   * Whether unsaved work may go. A dialog that cannot even be shown answers no:
   * the one thing worse than a button that does nothing is one that throws the
   * user's Flow away because asking them failed.
   */
  const confirmDiscard = useCallback(async () => {
    if (saved) return true
    try {
      return await files.confirmDiscard(editor.project.name)
    } catch (error) {
      setProblem(translate("project.problem.read", { message: describeError(error) }))
      return false
    }
  }, [saved, files, editor.project.name])

  /** Writes the open Project to `destination` and takes it as the saved one. */
  const writeTo = useCallback(
    async (destination: string) => {
      try {
        await writeProjectFile(destination, editor.project, files)
      } catch (error) {
        setProblem(translate("project.problem.write", { message: describeError(error) }))
        return
      }
      setPath(destination)
      setSavedDocument(serializeProject(editor.project))
      setProblem(undefined)
    },
    [editor.project, files]
  )

  const saveAs = useCallback(async () => {
    let destination: string | undefined
    try {
      destination = await files.chooseSavePath(suggestedFileName(editor.project))
    } catch (error) {
      setProblem(translate("project.problem.write", { message: describeError(error) }))
      return
    }
    if (destination === undefined) return
    await writeTo(destination)
  }, [editor.project, files, writeTo])

  return {
    path,
    saved,
    problem,

    create: useCallback(async () => {
      if (!(await confirmDiscard())) return
      const created = newProject()
      editor.replace(created)
      setPath(undefined)
      setSavedDocument(serializeProject(created))
      setProblem(undefined)
    }, [confirmDiscard, editor.replace]),

    open: useCallback(async () => {
      if (!(await confirmDiscard())) return

      let source: string | undefined
      let result: OpenProjectResult
      try {
        source = await files.chooseOpenPath()
        if (source === undefined) return
        result = await readProjectFile(source, files)
      } catch (error) {
        setProblem(translate("project.problem.read", { message: describeError(error) }))
        return
      }

      if (result.status !== "opened") {
        setProblem(explain(result))
        return
      }

      editor.replace(result.project)
      setPath(source)
      setSavedDocument(serializeProject(result.project))
      setProblem(undefined)

      // A Project that was behind is now in this build's format in memory only.
      // Writing it back is what makes the migration stick, and the backup taken
      // on the way in is what makes that safe.
      if (result.migrated) {
        try {
          await writeProjectFile(source, result.project, files)
        } catch (error) {
          // The Project is open and whole; only the file is still the old one.
          // Saying so is better than letting the next Save look like the first.
          setProblem(translate("project.problem.write", { message: describeError(error) }))
        }
      }
    }, [confirmDiscard, editor.replace, files]),

    save: useCallback(async () => {
      if (path === undefined) {
        await saveAs()
        return
      }
      await writeTo(path)
    }, [path, saveAs, writeTo]),

    saveAs,
    confirmDiscard
  }
}

/** What the user is told about a file this build would not open. */
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
