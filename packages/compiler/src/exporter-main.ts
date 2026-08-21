import { readFile } from "node:fs/promises"

import { exportRequestSchema, writeExportResult } from "./export-protocol.js"
import { runExport } from "./exporter.js"
import type { VendoredRuntime } from "./vendored-runtime.js"

/**
 * The exporter as it runs on the sidecar: read one request, write one answer,
 * stop.
 *
 * The request is named on the command line and read from a file rather than
 * arriving on standard input. A Project is as large as the user made it, which
 * rules out passing it as an argument outright, and a file also spares both
 * sides the one question a pipe raises — who closes it, and when.
 *
 * This is the entry point of the bundle the application ships (ADR 0007). It is
 * a real file rather than something the Compiler renders, because unlike a
 * Session's entry point nothing about it depends on the Project: every Export
 * runs the same code, and only the request differs.
 */

/**
 * The Runtime this build of Bot Inventor vendors, baked in when the exporter is
 * bundled.
 *
 * It is carried rather than read because there is nothing to read it from: an
 * installed application has no Runtime build on disk and no `node_modules` to
 * resolve one out of. `bundleExporter` is what puts it here.
 */
// The name is the placeholder the bundler substitutes, not ours to spell.
// oxlint-disable-next-line eslint/no-underscore-dangle
declare const __VENDORED_RUNTIME__: string

await main()

async function main(): Promise<void> {
  const answer = await answerOneRequest()
  process.stdout.write(writeExportResult(answer))

  // Everything that could go wrong has already been said in the answer, so the
  // exit code carries no information the editor needs. Zero keeps a refusal
  // from also looking like a process that crashed.
  process.exit(0)
}

async function answerOneRequest() {
  const [, , requestPath] = process.argv
  if (requestPath === undefined) {
    return refused("The exporter was given no Export to perform.")
  }

  let asked: unknown
  try {
    asked = JSON.parse(await readFile(requestPath, "utf8"))
  } catch (error) {
    return refused(`The Export request could not be read: ${describe(error)}`)
  }

  const request = exportRequestSchema.safeParse(asked)
  if (!request.success) {
    return refused(`This is not something this build knows how to Export: ${request.error.message}`)
  }

  return runExport(request.data, JSON.parse(__VENDORED_RUNTIME__) as VendoredRuntime)
}

function refused(message: string) {
  return { kind: "refused", reason: "failed", message } as const
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
