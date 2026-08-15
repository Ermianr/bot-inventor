import { copyFile, mkdir, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { build } from "esbuild"
import { NATIVE_ADDON_EXTERNALS, NODE_BUNDLE_BANNER } from "./bundle.js"
import { SIDECAR_NODE_TARGET } from "./development-runtime.js"
import { ExportError } from "./export-error.js"
import { readVendoredRuntime } from "./vendored-runtime.js"

/**
 * The exporter, bundled into the two files the application ships beside the
 * Node.js sidecar (ADR 0007).
 *
 * Like the Runtime a Session runs against, it is built once when the
 * application is packaged rather than assembled at Export time — but for a
 * stronger reason than speed. An installed Bot Inventor has no repository under
 * it: no Runtime build to copy into a Node Project, no `node_modules` for a
 * bundler to resolve against, and no esbuild to run. All three have to be
 * carried, and this is what carries them.
 */

/** The exporter itself, which the sidecar is pointed at. */
export const EXPORTER_NAME = "exporter.mjs"

/**
 * esbuild's own binary. It is a program rather than a library, so it cannot be
 * bundled into the file above and travels beside it; `ESBUILD_BINARY_PATH` is
 * how the bundled JavaScript is told where it went.
 */
export const EXPORTER_BUNDLER_NAME = "esbuild.exe"

/**
 * The environment variable esbuild reads its binary's location from. Bundled,
 * its own way of finding it — resolving a package relative to its file — has
 * nothing to find, so it is told instead.
 */
export const BUNDLER_PATH_VARIABLE = "ESBUILD_BINARY_PATH"

/**
 * The name the vendored Runtime is baked in under. It is replaced at build time
 * with the Runtime's source as a JSON string, which `exporter-main.ts` parses
 * once on startup.
 */
const VENDORED_RUNTIME = "__VENDORED_RUNTIME__"

/**
 * The esbuild platform package the binary comes out of. It is the only platform
 * v1 ships on, which is also the only one there is a sidecar for (ADR 0002).
 */
const BUNDLER_PACKAGE = "@esbuild/win32-x64"

export type BundleExporterOptions = {
  /** The directory both files are written into. It is created when it does not exist. */
  outputDirectory: string
}

export type ExporterBundle = {
  path: string
  bytes: number
  /** Where esbuild's binary was put, which the application has to ship as well. */
  bundlerPath: string
}

/**
 * Bundles the exporter and puts esbuild's binary beside it.
 *
 * It is built for the sidecar's Node.js rather than the floor an Export
 * targets: this is code that runs on the machine we pin (ADR 0002), not code
 * that lands on a host we do not control.
 */
export async function bundleExporter(options: BundleExporterOptions): Promise<ExporterBundle> {
  const runtime = await readVendoredRuntime()

  const bundled = await build({
    entryPoints: [join(import.meta.dirname, "exporter-main.js")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: SIDECAR_NODE_TARGET,
    external: [...NATIVE_ADDON_EXTERNALS],
    banner: { js: NODE_BUNDLE_BANNER },
    // Baked in rather than read: there is nothing to read it from once the
    // application is installed. Twice through `stringify` on purpose — the
    // outer one makes it a JavaScript string literal, the inner one is what
    // the exporter parses back into the Runtime.
    define: { [VENDORED_RUNTIME]: JSON.stringify(JSON.stringify(runtime)) },
    // The vendored Runtime is already-bundled output, and re-reading it turns
    // discord.js's own `eval` into a warning nobody can act on.
    logOverride: { "direct-eval": "silent" },
    write: false
  })

  const [output] = bundled.outputFiles
  if (output === undefined) {
    throw new ExportError("The bundler produced no exporter.")
  }

  await mkdir(options.outputDirectory, { recursive: true })
  const path = join(options.outputDirectory, EXPORTER_NAME)
  await writeFile(path, output.contents)

  const bundlerPath = join(options.outputDirectory, EXPORTER_BUNDLER_NAME)
  await copyFile(await findBundlerBinary(), bundlerPath)

  return { path, bytes: output.contents.byteLength, bundlerPath }
}

/**
 * esbuild's binary as this repository has it installed.
 *
 * It ships in a platform package of its own, and the one beside us is the one
 * every test in this repository has run against — which is the whole point of
 * copying it rather than downloading one.
 */
async function findBundlerBinary(): Promise<string> {
  let manifest: string
  try {
    // Resolved from esbuild rather than from here. The platform package is
    // esbuild's own optional dependency, so where a package manager puts it is
    // a question only esbuild's location can answer — under Bun it is not
    // anywhere the Compiler can see.
    const esbuild = createRequire(import.meta.url).resolve("esbuild")
    manifest = createRequire(esbuild).resolve(`${BUNDLER_PACKAGE}/package.json`)
  } catch {
    throw new ExportError(
      `${BUNDLER_PACKAGE} is not installed beside esbuild, so the exporter would have no bundler to run. Install dependencies and try again.`
    )
  }

  const binary = join(dirname(manifest), EXPORTER_BUNDLER_NAME)
  if (!(await exists(binary))) {
    throw new ExportError(`esbuild's binary is not at ${binary}, so the exporter has no bundler.`)
  }
  return binary
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
