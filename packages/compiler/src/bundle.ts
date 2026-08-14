/**
 * What every bundle we hand to Node.js needs, whether it is an Export the user
 * hosts or the Runtime a Session runs against.
 *
 * None of it is guesswork: each value here has been observed to break the
 * bundle when changed, and the reasoning is recorded in ADR 0004.
 */

/**
 * The optional native addons discord.js and `ws` probe for and fall back away
 * from when they are absent. They resolve to `.node` binaries, which esbuild
 * has no loader for, so they are excluded unconditionally: whether they are
 * installed depends on the machine doing the bundling, never on the Project, so
 * a build that happens to pass here proves nothing about anywhere else.
 */
export const NATIVE_ADDON_EXTERNALS: readonly string[] = [
  "zlib-sync",
  "bufferutil",
  "utf-8-validate"
]

/**
 * discord.js is CommonJS internally, and esbuild's interop emits a `__require`
 * that throws `Dynamic require of "node:events" is not supported` on the first
 * line of execution. Defining it from `import.meta.url` is what makes the
 * bundle run at all; `__filename` and `__dirname` are defensive, because
 * bundled CommonJS commonly reads them.
 */
export const NODE_BUNDLE_BANNER = [
  'import { createRequire as __createRequire } from "node:module"',
  'import { fileURLToPath as __fileURLToPath } from "node:url"',
  'import { dirname as __pathDirname } from "node:path"',
  "const require = __createRequire(import.meta.url)",
  "const __filename = __fileURLToPath(import.meta.url)",
  "const __dirname = __pathDirname(__filename)"
].join("\n")
