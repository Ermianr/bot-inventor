import { readdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { build } from "esbuild"

import { NATIVE_ADDON_EXTERNALS } from "./bundle.js"
import { ExportError } from "./export-error.js"
import { SINGLE_FILE_TARGET } from "./export-target.js"
import { type GeneratedFile, RUNTIME_DIRECTORY } from "./node-project.js"

/**
 * The Runtime as a Node Project Export carries it: its source, and the npm
 * ranges the Export's `package.json` has to ask for.
 *
 * It is copied into the Export rather than installed from npm because the
 * Runtime is not published, and the Export has to keep running long after the
 * Bot Inventor that wrote it is gone (ADR 0005).
 *
 * It is a value rather than something `exportNodeProject` goes and reads
 * because of where an Export actually happens. In this repository it is read
 * off the Runtime's build, which is what the tests and the packaging scripts
 * do. In a user's installed application there is no build to read: the sources
 * are baked into the exporter when the application is packaged, and handed in.
 * Either way `exportNodeProject` writes the same folder.
 */
export type VendoredRuntime = {
  /** The Runtime's source, at the paths it takes inside a Node Project Export. */
  files: readonly GeneratedFile[]
  /** What the Export's `package.json` declares, the Runtime's own plus dotenv. */
  dependencies: Readonly<Record<string, string>>
  /**
   * The same Runtime with everything it needs already inside it, as one module.
   *
   * The Single File Export has nothing to resolve against — no `node_modules`
   * where it is written, and none where the installed application runs — so the
   * Runtime and discord.js under it are bundled here, once, and the Export
   * bundles the bot around this rather than around a package on disk.
   */
  bundled: string
}

/**
 * What generated code imports the Runtime as. An Export answers this itself
 * rather than letting a bundler resolve it, so it is named once and used at
 * both ends.
 */
export const RUNTIME_PACKAGE = "@bot-inventor/runtime"

/**
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
 * Reads the Runtime out of the build this Bot Inventor was made from.
 *
 * This is the side of it that needs a repository around it, so it runs where
 * there is one: in the tests, and in the packaging script that bakes the result
 * into the exporter.
 */
export async function readVendoredRuntime(): Promise<VendoredRuntime> {
  const entry = resolveRuntime()
  return {
    files: await readRuntime(entry),
    dependencies: await resolveDependencies(entry),
    bundled: await bundleRuntime()
  }
}

/**
 * The Runtime and everything under it as one module, built for the Node.js an
 * Export targets.
 *
 * Doing it here rather than at Export time is what lets there be one Single
 * File path instead of two. A packaged application has no Runtime package to
 * resolve, so if the Export bundled from source it would need a second route
 * for the installed case — and the route the tests exercise would not be the
 * route users get, which is the way a format quietly stops working.
 */
async function bundleRuntime(): Promise<string> {
  const bundled = await build({
    stdin: {
      contents: `export { createDiscordRuntime } from "${RUNTIME_PACKAGE}"`,
      sourcefile: "runtime.mjs",
      loader: "js",
      // Resolved from this package rather than from wherever an Export lands.
      resolveDir: import.meta.dirname
    },
    bundle: true,
    // Without this esbuild resolves browser fields and tries to polyfill the
    // Node.js builtins discord.js is built on.
    platform: "node",
    format: "esm",
    target: SINGLE_FILE_TARGET,
    external: [...NATIVE_ADDON_EXTERNALS],
    // No banner: this is not a module anybody runs on its own. It is inlined
    // into an Export, which puts the banner at the top of the whole file — and
    // two copies of it in one file is a redeclaration Node.js refuses to load.
    write: false
  })

  const [output] = bundled.outputFiles
  if (output === undefined) {
    throw new ExportError("The bundler produced no Runtime for an Export to vendor.")
  }
  return output.text
}

/**
 * The Runtime's compiled JavaScript. It is already plain ESM with its comments
 * intact, so it goes into an Export as it is rather than bundled or minified —
 * readability is the format's whole point.
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
      `The Runtime's build contains ${entry.name}, which this Export does not know how to copy. Teach readVendoredRuntime about it before Exporting.`
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
    return resolveFrom.resolve(RUNTIME_PACKAGE)
  } catch {
    throw new ExportError(
      "The Runtime has not been built, so there is nothing to copy into an Export. Build @bot-inventor/runtime and Export again."
    )
  }
}
