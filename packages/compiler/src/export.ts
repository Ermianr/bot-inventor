/**
 * Everything the Compiler does that touches a bundler and a disk: the two
 * Export formats, and the Runtime a Session runs against.
 *
 * They live apart from the Compiler's main entry because of that: the editor
 * imports the main entry into the browser, where neither esbuild nor `node:fs`
 * exists, and only the Tauri side and the packaging scripts reach for this one.
 */

export { NATIVE_ADDON_EXTERNALS } from "./bundle.js"
export {
  type BundleDevelopmentRuntimeOptions,
  bundleDevelopmentRuntime,
  type DevelopmentRuntimeBundle,
  SIDECAR_NODE_TARGET
} from "./development-runtime.js"
export { ExportError } from "./export-error.js"
export {
  type ExportNodeProjectOptions,
  exportNodeProject,
  type NodeProjectExport
} from "./export-node-project.js"
export {
  type ExportSingleFileOptions,
  exportSingleFile,
  SINGLE_FILE_NAME,
  SINGLE_FILE_TARGET,
  type SingleFileExport
} from "./export-single-file.js"
export {
  ENTRY_FILE_NAME,
  FLOWS_DIRECTORY,
  RUNTIME_DIRECTORY,
  TOKEN_VARIABLE
} from "./node-project.js"
