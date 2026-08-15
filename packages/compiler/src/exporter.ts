import { ExportError } from "./export-error.js"
import { exportNodeProject } from "./export-node-project.js"
import type { ExportRequest, ExportResult } from "./export-protocol.js"
import { exportSingleFile } from "./export-single-file.js"
import type { VendoredRuntime } from "./vendored-runtime.js"

/**
 * Doing what `export-protocol.ts` describes.
 *
 * It is separate from the protocol because of who reads which. The protocol is
 * plain data and the editor imports it, in a webview with no bundler and no
 * file system; this reaches for both, and only the sidecar runs it.
 */

/**
 * Performs one Export and describes what happened, without throwing.
 *
 * A refusal is an answer rather than a crash because the caller is a process
 * on the other side of a pipe: an exit code and a stack trace tell the editor
 * nothing it can put in front of the user.
 */
export async function runExport(
  request: ExportRequest,
  runtime: VendoredRuntime
): Promise<ExportResult> {
  try {
    if (request.format === "single-file") {
      const written = await exportSingleFile(request.project, {
        outputDirectory: request.outputDirectory,
        overwrite: request.overwrite,
        runtime
      })
      return { kind: "exported", format: request.format, path: written.path, bytes: written.bytes }
    }

    const written = await exportNodeProject(request.project, {
      outputDirectory: request.outputDirectory,
      overwrite: request.overwrite,
      runtime
    })
    return {
      kind: "exported",
      format: request.format,
      path: written.path,
      files: [...written.files]
    }
  } catch (error) {
    return {
      kind: "refused",
      reason: error instanceof ExportError && error.alreadyExists ? "already-exists" : "failed",
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
