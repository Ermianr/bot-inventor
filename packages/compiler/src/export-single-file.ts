import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { NodeCatalogue } from "@bot-inventor/nodes"
import type { Project } from "@bot-inventor/schema"
import { build, type Plugin } from "esbuild"

import { NATIVE_ADDON_EXTERNALS, NODE_BUNDLE_BANNER } from "./bundle.js"
import { compile } from "./compile.js"
import { ExportError } from "./export-error.js"
import { SINGLE_FILE_TARGET } from "./export-target.js"
import { exists } from "./files.js"
import { RUNTIME_PACKAGE, readVendoredRuntime, type VendoredRuntime } from "./vendored-runtime.js"

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
  /**
   * The Runtime this Export is built around. It defaults to the one built in
   * this repository, which is what the tests and the packaging scripts want;
   * the installed application has no build to read and hands in the one baked
   * into it instead.
   */
  runtime?: VendoredRuntime
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
    throw new ExportError(
      `An Export already exists at ${path}. Exporting again would replace it.`,
      { alreadyExists: true, path }
    )
  }

  const runtime = options.runtime ?? (await readVendoredRuntime())

  // Build mode is the whole point of the format: no Tracing reaches the file
  // the user hosts.
  const built = compile(project, { mode: "build", catalogue: options.catalogue })

  const bundled = await build({
    stdin: {
      contents: built.source,
      sourcefile: SINGLE_FILE_NAME,
      loader: "js",
      resolveDir: import.meta.dirname
    },
    bundle: true,
    // Without this esbuild resolves browser fields and tries to polyfill the
    // Node.js builtins discord.js is built on.
    platform: "node",
    format: "esm",
    target: SINGLE_FILE_TARGET,
    external: [...NATIVE_ADDON_EXTERNALS],
    banner: { js: NODE_BUNDLE_BANNER },
    plugins: [vendoredRuntime(runtime)],
    // The vendored Runtime is already-bundled output rather than source, and
    // re-reading it turns discord.js's own `eval` into a warning on every
    // Export. It is not the user's code and there is nothing for them to do
    // about it, so it is not worth a line in the panel.
    logOverride: { "direct-eval": "silent" },
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

/**
 * Answers the Build's one import with the Runtime that was bundled ahead of
 * time, rather than letting esbuild go looking for a package.
 *
 * Nothing is resolved from disk here on purpose: an installed Bot Inventor has
 * no `node_modules` to resolve against, and a route that only works inside this
 * repository is a format that quietly stops working once it ships.
 */
function vendoredRuntime(runtime: VendoredRuntime): Plugin {
  const namespace = "bot-inventor-runtime"

  return {
    name: namespace,
    setup(bundler) {
      bundler.onResolve({ filter: new RegExp(`^${RUNTIME_PACKAGE}$`) }, () => ({
        path: RUNTIME_PACKAGE,
        namespace
      }))
      bundler.onLoad({ filter: /.*/, namespace }, () => ({
        contents: runtime.bundled,
        loader: "js"
      }))
    }
  }
}
