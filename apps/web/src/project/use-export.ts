import type { ExportFormat } from "@bot-inventor/compiler"
import type { Project } from "@bot-inventor/schema"
import { useCallback, useState } from "react"

import { translate } from "@/i18n/messages"
import type { ExportGateway } from "@/project/export-gateway"
import { describeError } from "@/project/project-file"

/**
 * Taking the bot away: the Project as something that runs without Bot Inventor.
 *
 * The whole of it from the editor's side is one question — which format — and
 * then three things the user is owed: where it went, a warning before anything
 * of theirs is replaced, and a reason when it did not happen.
 */
export type Exporting = {
  /** Where the last Export went, in words, until another one is asked for. */
  written: string | undefined
  /** Why the last Export did not happen, when it did not. */
  problem: string | undefined
  /** Whether one is going on. Bundling takes seconds, and silence looks broken. */
  busy: boolean
  exportAs(format: ExportFormat): Promise<void>
}

export function useExport(project: Project, exports: ExportGateway): Exporting {
  const [written, setWritten] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      setWritten(undefined)
      setProblem(undefined)

      let outputDirectory: string | undefined
      try {
        outputDirectory = await exports.chooseDestination(format)
      } catch (error) {
        setProblem(translate("export.problem.failed", { message: describeError(error) }))
        return
      }
      // The user closed the dialog. Nothing was asked for, so nothing is said.
      if (outputDirectory === undefined) return

      setBusy(true)
      try {
        let result = await exports.run({ format, project, outputDirectory })

        // The one refusal the user can answer. Everything of theirs is still
        // where it was until they say otherwise.
        if (result.kind === "refused" && result.reason === "already-exists") {
          // What is in the way rather than where it was put: for a Single File
          // those are different things, and asking about the folder when the
          // file is what goes is how somebody agrees to lose the wrong thing.
          if (!(await exports.confirmOverwrite(result.path ?? outputDirectory))) return
          result = await exports.run({ format, project, outputDirectory, overwrite: true })
        }

        if (result.kind === "exported") {
          setWritten(translate(whereItWent(format), { path: result.path }))
        } else {
          setProblem(translate("export.problem.failed", { message: result.message }))
        }
      } catch (error) {
        setProblem(translate("export.problem.failed", { message: describeError(error) }))
      } finally {
        setBusy(false)
      }
    },
    [exports, project]
  )

  return { written, problem, busy, exportAs }
}

/** How the two formats describe what they left behind: a file, or a folder. */
function whereItWent(format: ExportFormat) {
  return format === "single-file" ? "export.written.file" : "export.written.folder"
}
