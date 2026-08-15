import { projectSchema } from "@bot-inventor/schema"
import { z } from "zod"

/**
 * An Export as it is asked for and answered across a process boundary.
 *
 * Both Export formats need a bundler, a file system and the Runtime's own
 * source, and none of those exist in the webview. So an Export runs where a
 * Session already runs — on the Node.js sidecar (ADR 0007) — and this is the
 * whole of what the two sides say to each other.
 *
 * Both ends live here for the same reason both ends of a Session live in
 * `development-session.ts`: the thing that reads a message is a few lines below
 * the thing that writes it, which is the only way to keep them from drifting.
 * Performing the Export is next door in `exporter.ts`, because that half needs
 * a bundler and a file system and the editor cannot import either.
 *
 * Unlike a Session, this is one question and one answer. The exporter says
 * exactly one thing and stops, so there is no prefix to look for and no stream
 * to keep reading: whatever esbuild wants to print goes to standard error, and
 * standard output is the answer.
 */

/** Which of the two formats the user asked for. */
export const EXPORT_FORMATS = ["single-file", "node-project"] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const exportRequestSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  /**
   * The Project to Export, validated here rather than trusted. It crossed a
   * process boundary as text, and the exporter is the last place that can say
   * "this is not a Project" instead of failing somewhere inside the Compiler.
   */
  project: projectSchema,
  /** Where the user chose to put it. The editor asks; nothing here invents one. */
  outputDirectory: z.string(),
  /**
   * Whether to write over an Export that is already there. The editor only
   * sends `true` after the user has been warned and agreed, which is what keeps
   * a second Export from destroying the first one silently.
   */
  overwrite: z.boolean().optional()
})

export type ExportRequest = z.infer<typeof exportRequestSchema>

export const exportResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exported"),
    format: z.enum(EXPORT_FORMATS),
    /** Where it went, which is the thing the user is told. */
    path: z.string(),
    /** How big the Single File came out, so the panel can say. */
    bytes: z.number().optional(),
    /** What a Node Project Export wrote, relative to its folder. */
    files: z.array(z.string()).optional()
  }),
  /**
   * Nothing was written. `already-exists` is kept apart from every other
   * failure because it is the only one the user can answer: they are asked
   * whether to replace what is there, and the Export is sent again.
   */
  z.object({
    kind: z.literal("refused"),
    reason: z.enum(["already-exists", "failed"]),
    message: z.string(),
    /**
     * What is in the way, when something is: the file a Single File would
     * replace, the folder a Node Project would. It is what the user is asked
     * about, so it has to be the thing that would actually go.
     */
    path: z.string().optional()
  })
])

export type ExportResult = z.infer<typeof exportResultSchema>

/**
 * Reads what the exporter said.
 *
 * It is given everything the process wrote, because a bundler that decides to
 * print something is not a reason to lose the answer: the last line that parses
 * as a result is the result. Nothing recognisable at all is itself reported, so
 * that an exporter which died on its way to answering says so rather than
 * leaving the editor waiting.
 */
export function readExportResult(output: string): ExportResult {
  for (const line of output.split("\n").reverse()) {
    if (line.trim().length === 0) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const result = exportResultSchema.safeParse(parsed)
    if (result.success) return result.data
  }

  return {
    kind: "refused",
    reason: "failed",
    message:
      output.trim().length === 0
        ? "The exporter stopped without saying anything."
        : output.trim().slice(-MOST_OF_A_MESSAGE)
  }
}

/**
 * How much of an unreadable answer is worth keeping. It is the tail rather than
 * the head because a process that died says why on its way out.
 */
const MOST_OF_A_MESSAGE = 2000

/** How the exporter answers: one line, on standard output, and nothing else. */
export function writeExportResult(result: ExportResult): string {
  return `${JSON.stringify(result)}\n`
}
