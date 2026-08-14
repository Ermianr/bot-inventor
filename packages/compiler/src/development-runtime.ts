import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { build } from "esbuild"
import { NATIVE_ADDON_EXTERNALS, NODE_BUNDLE_BANNER } from "./bundle.js"
import { SESSION_RUNTIME_NAME } from "./development-session.js"
import { ExportError } from "./export-error.js"

/**
 * The Runtime a Session runs against, bundled into one file.
 *
 * It is built once, when the application is packaged, and shipped as a resource
 * beside the Node.js sidecar. Pressing Run then only writes the entry point
 * next to it — no bundler, no install, no `node_modules` between the user and
 * their bot connecting.
 *
 * That the Runtime is frozen at packaging time is the point: every Session on a
 * given build of Bot Inventor runs on the same Runtime, the one its tests ran
 * against, rather than on whatever resolving happened to find.
 */

/**
 * The Node.js the Runtime is compiled down to. Unlike an Export, which lands on
 * a host we do not control, a Session always runs on the sidecar, so this
 * follows the version ADR 0002 pins rather than the floor we support.
 */
export const SIDECAR_NODE_TARGET = "node22"

export type BundleDevelopmentRuntimeOptions = {
  /** The directory the Runtime is written into. It is created when it does not exist. */
  outputDirectory: string
}

export type DevelopmentRuntimeBundle = {
  path: string
  bytes: number
}

/**
 * Bundles `@bot-inventor/runtime` into the single file a Session's entry point
 * imports. What it exports is what generated code is written against, and
 * nothing else: the surface is the Runtime's, not esbuild's.
 */
export async function bundleDevelopmentRuntime(
  options: BundleDevelopmentRuntimeOptions
): Promise<DevelopmentRuntimeBundle> {
  const bundled = await build({
    stdin: {
      contents: 'export { createDiscordRuntime } from "@bot-inventor/runtime"',
      sourcefile: SESSION_RUNTIME_NAME,
      loader: "js",
      // Resolved from this package rather than from wherever the bundle is
      // being written, which is a folder with nothing installed in it.
      resolveDir: import.meta.dirname
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: SIDECAR_NODE_TARGET,
    external: [...NATIVE_ADDON_EXTERNALS],
    banner: { js: NODE_BUNDLE_BANNER },
    write: false
  })

  const [output] = bundled.outputFiles
  if (output === undefined) {
    throw new ExportError("The bundler produced no Runtime for Development Mode.")
  }

  await mkdir(options.outputDirectory, { recursive: true })
  const path = join(options.outputDirectory, SESSION_RUNTIME_NAME)
  await writeFile(path, output.contents)

  return { path, bytes: output.contents.byteLength }
}
