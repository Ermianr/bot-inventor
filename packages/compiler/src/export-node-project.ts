import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { NodeCatalogue } from "@bot-inventor/nodes"
import type { Project } from "@bot-inventor/schema"
import { ExportError } from "./export-error.js"
import { exists } from "./files.js"
import { FLOWS_DIRECTORY, RUNTIME_DIRECTORY, renderNodeProject } from "./node-project.js"
import { readVendoredRuntime, type VendoredRuntime } from "./vendored-runtime.js"

/**
 * The Node Project Export: a folder of readable source with a `package.json`,
 * an `.env.example` and a README, for someone who wants to version their bot,
 * learn from it, or hand it to a developer.
 *
 * Where the Single File is one bundle nobody is meant to open, this is the
 * opposite trade: `npm install` is required, and in exchange every file in the
 * folder is source a person can follow. Like the Single File it reads its token
 * from the environment and carries no Tracing.
 *
 * It is reached through `@bot-inventor/compiler/export`, which is where both
 * formats live.
 */

/**
 * The file whose presence says a folder already holds an Export. It is written
 * last for that reason: a half-written folder must not look like a whole one.
 */
const MARKER_FILE = "package.json"

/**
 * The directories an Export owns outright. They are emptied before writing, so
 * that a renamed Flow or a Runtime file that no longer exists leaves nothing
 * behind pretending to still be part of the bot.
 */
const GENERATED_DIRECTORIES = [FLOWS_DIRECTORY, RUNTIME_DIRECTORY]

export type ExportNodeProjectOptions = {
  /** The directory the folder is written into. It is created when it does not exist. */
  outputDirectory: string
  /** Overridable so a test can Export against a catalogue of its own. */
  catalogue?: NodeCatalogue
  /**
   * Refuses to write into a directory that already has an Export in it. The
   * editor asks the user before passing `true`, so that a second Export cannot
   * destroy hand-edits to the first one without them hearing about it.
   */
  overwrite?: boolean
  /**
   * The Runtime this Export vendors. It defaults to the one built in this
   * repository, which is what the tests and the packaging scripts want; the
   * installed application has no build to read and hands in the one baked into
   * it instead.
   */
  runtime?: VendoredRuntime
}

export type NodeProjectExport = {
  /** The folder that was written, so the user can be told where to find it. */
  path: string
  /** Every file written, relative to the folder and in POSIX form. */
  files: readonly string[]
}

/**
 * Builds a Project and writes it as a Node Project.
 *
 * The token is not an input: the generated entry point reads it from the
 * environment, so the folder this produces is one the user can push to GitHub
 * without leaking their bot.
 */
export async function exportNodeProject(
  project: Project,
  options: ExportNodeProjectOptions
): Promise<NodeProjectExport> {
  const marker = join(options.outputDirectory, MARKER_FILE)
  const replacing = await exists(marker)

  if (options.overwrite !== true && replacing) {
    throw new ExportError(
      `An Export already exists at ${options.outputDirectory}. Exporting again would replace it.`,
      { alreadyExists: true, path: options.outputDirectory }
    )
  }

  const runtime = options.runtime ?? (await readVendoredRuntime())
  // The Flows are rendered in Build mode, which is the whole point of the
  // format: no Tracing reaches the folder the user hosts.
  const generated = renderNodeProject(project, {
    catalogue: options.catalogue,
    dependencies: runtime.dependencies
  })
  const files = [...generated, ...runtime.files]

  // Both directories belong to an Export entirely, so emptying them is what
  // makes the README's promise true: a Flow the user renamed leaves no file
  // behind pretending to still be part of the bot.
  //
  // Only when there is an Export here to replace, though. In a folder of the
  // user's own these are two ordinary names, and deleting a `flows` directory
  // somebody else put there — without it being the Export they were warned
  // about — is the destruction this whole path exists to prevent.
  if (replacing) {
    for (const directory of GENERATED_DIRECTORIES) {
      await rm(join(options.outputDirectory, directory), { recursive: true, force: true })
    }
  }

  // The marker goes last. Written first, a write that failed halfway would
  // leave behind just enough of an Export to make the next one refuse.
  const order = [...files].sort(
    (left, right) => Number(left.path === MARKER_FILE) - Number(right.path === MARKER_FILE)
  )

  for (const file of order) {
    const path = join(options.outputDirectory, file.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.contents, "utf8")
  }

  return { path: options.outputDirectory, files: files.map(file => file.path) }
}
