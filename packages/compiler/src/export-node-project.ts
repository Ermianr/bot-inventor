import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { NodeCatalogue } from "@bot-inventor/nodes"
import type { Project } from "@bot-inventor/schema"
import { ExportError } from "./export-error.js"
import {
  FLOWS_DIRECTORY,
  type GeneratedFile,
  RUNTIME_DIRECTORY,
  renderNodeProject
} from "./node-project.js"

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
 * The Runtime is copied into the Export rather than installed from npm, because
 * it is not published: the Export must keep running long after the Bot Inventor
 * that wrote it is gone. See ADR 0005.
 *
 * `testing.js` is left out — it is the fake Runtime our own tests run against,
 * and it has no business in a bot someone hosts.
 */
const RUNTIME_FILES_TO_SKIP = new Set(["testing.js"])

/** TypeScript's own by-products: they are for this repository, not for the Export. */
const RUNTIME_FILES_LEFT_BEHIND = /\.(d\.ts|map)$/

/**
 * The one package the Export needs that the Runtime does not: the generated
 * entry point reads `.env`, which is what makes `.env.example` worth documenting.
 */
const ENTRY_POINT_DEPENDENCY = "dotenv"

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
  if (options.overwrite !== true && (await exists(marker))) {
    throw new ExportError(
      `An Export already exists at ${options.outputDirectory}. Exporting again would replace it.`
    )
  }

  const runtimeEntry = resolveRuntime()
  // The Flows are rendered in Build mode, which is the whole point of the
  // format: no Tracing reaches the folder the user hosts.
  const generated = renderNodeProject(project, {
    catalogue: options.catalogue,
    dependencies: await resolveDependencies(runtimeEntry)
  })
  const files = [...generated, ...(await readRuntime(runtimeEntry))]

  // Both directories are ours entirely, so emptying them is what makes the
  // README's promise true: a Flow the user renamed leaves no file behind
  // pretending to still be part of the bot.
  for (const directory of GENERATED_DIRECTORIES) {
    await rm(join(options.outputDirectory, directory), { recursive: true, force: true })
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

/**
 * The Runtime's compiled JavaScript, read from the build this Bot Inventor
 * ships. It is already plain ESM with its comments intact, so it goes into the
 * Export as it is rather than being bundled or minified.
 */
async function readRuntime(runtimeEntry: string): Promise<readonly GeneratedFile[]> {
  const directory = dirname(runtimeEntry)
  const entries = await readdir(directory, { withFileTypes: true })
  const names: string[] = []

  for (const entry of entries) {
    if (RUNTIME_FILES_TO_SKIP.has(entry.name)) continue
    if (entry.isFile() && entry.name.endsWith(".js")) {
      names.push(entry.name)
      continue
    }
    // The declarations and the source maps belong to this repository and stay
    // behind. Anything else is a Runtime build we do not know how to copy, and
    // guessing would ship a folder that fails on `npm start` in the user's
    // hands rather than here.
    if (entry.isFile() && RUNTIME_FILES_LEFT_BEHIND.test(entry.name)) continue
    throw new ExportError(
      `The Runtime's build contains ${entry.name}, which this Export does not know how to copy. Teach exportNodeProject about it before Exporting.`
    )
  }

  return Promise.all(
    names.map(async name => ({
      path: `${RUNTIME_DIRECTORY}/${name}`,
      // The source maps stay behind, so the reference to them would dangle.
      contents: stripSourceMapComment(await readFile(join(directory, name), "utf8"))
    }))
  )
}

function stripSourceMapComment(source: string): string {
  return source.replace(/^\/\/# sourceMappingURL=.*$\n?/gm, "")
}

/**
 * What the exported `package.json` asks npm for: whatever the vendored Runtime
 * itself depends on, plus the entry point's own. Copying the Runtime's ranges
 * rather than writing our own down here is what stops an Export from asking for
 * a discord.js the code beside it has never run on.
 */
async function resolveDependencies(runtimeEntry: string): Promise<Record<string, string>> {
  // The Runtime's manifest sits above its build output, and its `exports` does
  // not offer it, so it is reached by path rather than by resolution.
  const runtime = await readManifest(join(dirname(runtimeEntry), "..", "package.json"))
  const dependencies: Record<string, string> = { ...runtime.dependencies }

  if (Object.keys(dependencies).length === 0) {
    // The Runtime is a layer over discord.js, so a Runtime that depends on
    // nothing is a manifest that was not read, not a leaner bot. Shipped, it
    // installs cleanly and then dies on its first import.
    throw new ExportError(
      "The Runtime declares no dependencies, so an Export would install nothing for it to run on."
    )
  }

  for (const [name, range] of Object.entries(dependencies)) {
    // `workspace:`, `catalog:` and friends mean something only inside this
    // repository. Left in, npm install would fail in the user's folder rather
    // than here, where the mistake actually is.
    if (range.includes(":")) {
      throw new ExportError(
        `The Runtime depends on ${name} at "${range}", which no exported bot can install.`
      )
    }
  }

  // dotenv is the Compiler's contribution rather than the Runtime's, and the
  // version installed beside us is the one the entry point has been run against.
  const dotenv = await readManifest(resolvePackage(`${ENTRY_POINT_DEPENDENCY}/package.json`))
  if (dotenv.version === undefined) {
    throw new ExportError(
      `${ENTRY_POINT_DEPENDENCY} is installed without a version, so no Export can ask for it.`
    )
  }
  dependencies[ENTRY_POINT_DEPENDENCY] = `^${dotenv.version}`

  return dependencies
}

type Manifest = { version?: string; dependencies?: Record<string, string> }

async function readManifest(path: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Manifest
  } catch {
    throw new ExportError(
      `The manifest at ${path} could not be read, so there is nothing to Export.`
    )
  }
}

const resolveFrom = createRequire(import.meta.url)

function resolvePackage(specifier: string): string {
  try {
    return resolveFrom.resolve(specifier)
  } catch {
    throw new ExportError(
      `${specifier} cannot be found next to the Compiler, so there is nothing to Export.`
    )
  }
}

/**
 * The Runtime's build output, which is what an Export copies. Resolution is
 * what fails when it has not been built — its `exports` points into `dist` —
 * so that is the failure worth naming, rather than a missing dependency.
 */
function resolveRuntime(): string {
  try {
    return resolveFrom.resolve("@bot-inventor/runtime")
  } catch {
    throw new ExportError(
      "The Runtime has not been built, so there is nothing to copy into an Export. Build @bot-inventor/runtime and Export again."
    )
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
