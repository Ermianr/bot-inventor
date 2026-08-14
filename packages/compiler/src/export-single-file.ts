import { mkdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { NodeCatalogue } from "@bot-inventor/nodes"
import type { Project } from "@bot-inventor/schema"
import { build } from "esbuild"
import { compile } from "./compile.js"
import { ExportError } from "./export-error.js"

/**
 * The Single File Export: a Build bundled with esbuild into one `.mjs` that
 * runs on a bare Node.js installation with no `node_modules` next to it.
 *
 * Everything decided here comes from the spike recorded in ADR 0004, not from
 * guesswork: the externals, the format, the banner and the extension are all
 * load-bearing and each one of them has been observed to break the bundle when
 * changed.
 *
 * This is reached through `@bot-inventor/compiler/export`, which is where both
 * formats live.
 */

/** The name of the file an Export writes. The extension is part of ADR 0004. */
export const SINGLE_FILE_NAME = "bot.mjs"

/**
 * The optional native addons discord.js and `ws` probe for and fall back away
 * from when they are absent. They resolve to `.node` binaries, which esbuild
 * has no loader for, so they are excluded unconditionally: whether they are
 * installed depends on the machine doing the bundling, never on the Project, so
 * a build that happens to pass here proves nothing about anywhere else.
 */
export const SINGLE_FILE_EXTERNALS: readonly string[] = [
  "zlib-sync",
  "bufferutil",
  "utf-8-validate"
]

/**
 * The Node.js the Export is compiled down to. It is the floor we support rather
 * than the version the sidecar pins, because an Export runs on the user's host,
 * which we do not control.
 */
export const SINGLE_FILE_TARGET = "node20"

/**
 * discord.js is CommonJS internally, and esbuild's interop emits a `__require`
 * that throws `Dynamic require of "node:events" is not supported` on the first
 * line of execution. Defining it from `import.meta.url` is what makes the
 * bundle run at all; `__filename` and `__dirname` are defensive, because
 * bundled CommonJS commonly reads them.
 */
const BANNER = [
  'import { createRequire as __createRequire } from "node:module"',
  'import { fileURLToPath as __fileURLToPath } from "node:url"',
  'import { dirname as __pathDirname } from "node:path"',
  "const require = __createRequire(import.meta.url)",
  "const __filename = __fileURLToPath(import.meta.url)",
  "const __dirname = __pathDirname(__filename)"
].join("\n")

export type ExportSingleFileOptions = {
  /** The directory the file is written into. It is created when it does not exist. */
  outputDirectory: string
  /** Overridable so a test can Export against a catalogue of its own. */
  catalogue?: NodeCatalogue
  /**
   * Refuses to write over an Export that is already there. The editor asks the
   * user before passing `true`, so that a second Export cannot destroy the
   * first one without them hearing about it.
   */
  overwrite?: boolean
}

export type SingleFileExport = {
  /** Where the file was written, so the user can be told where to find it. */
  path: string
  bytes: number
}

/**
 * Builds a Project and writes it as a Single File.
 *
 * The token is not an input: the generated bootstrap reads it from the
 * environment, so the file this produces is something the user can put on
 * GitHub without leaking their bot.
 */
export async function exportSingleFile(
  project: Project,
  options: ExportSingleFileOptions
): Promise<SingleFileExport> {
  const path = join(options.outputDirectory, SINGLE_FILE_NAME)

  if (options.overwrite !== true && (await exists(path))) {
    throw new ExportError(`An Export already exists at ${path}. Exporting again would replace it.`)
  }

  // Build mode is the whole point of the format: no Tracing reaches the file
  // the user hosts.
  const built = compile(project, { mode: "build", catalogue: options.catalogue })

  const bundled = await build({
    stdin: {
      contents: built.source,
      sourcefile: SINGLE_FILE_NAME,
      loader: "js",
      // The Build imports `@bot-inventor/runtime`, which is resolved from this
      // package rather than from wherever the Export is being written.
      resolveDir: import.meta.dirname
    },
    bundle: true,
    // Without this esbuild resolves browser fields and tries to polyfill the
    // Node.js builtins discord.js is built on.
    platform: "node",
    format: "esm",
    target: SINGLE_FILE_TARGET,
    external: [...SINGLE_FILE_EXTERNALS],
    banner: { js: BANNER },
    write: false
  })

  const [output] = bundled.outputFiles
  if (output === undefined) {
    throw new ExportError("The bundler produced no file.")
  }

  await mkdir(options.outputDirectory, { recursive: true })
  await writeFile(path, output.contents)

  return { path, bytes: output.contents.byteLength }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
