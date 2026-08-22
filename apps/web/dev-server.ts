import index from "./index.html"

/**
 * The editor's dev server, which is what `tauri dev` points `devUrl` at.
 *
 * It is started from the repository root rather than from `apps/web`, and the
 * `dev` script does that with a `cd`. Bun binds its file watcher to the working
 * directory and refuses everything outside it — run from `apps/web`, every file
 * in `packages/ui` comes back as "not in the project directory and will not be
 * watched" and editing a shared component does nothing until a restart.
 *
 * There is no counterpart to the `src-tauri` exclusion `vite.config.ts` carried.
 * That exclusion existed because Vite watches directory trees, and `tauri dev`
 * writes into `target` and the sidecar binary while the dev server is up, which
 * on Windows takes the watcher down with an EBUSY. Bun watches only the files it
 * resolved into the module graph, so nothing under `src-tauri` is ever watched
 * and there is nothing to exclude. This was tested rather than assumed: ~6 GB
 * written into `src-tauri/target` while the server was up, no EBUSY, server
 * still serving.
 *
 * Tailwind and the React Compiler are not mounted here — they are `bunfig.toml`
 * plugins, because that is the only place Bun's dev server reads them from.
 */
const server = Bun.serve({
  port: 3001,
  development: {
    hmr: true,
    // Browser console output is echoed into the terminal running this, which is
    // the only place to see it when the editor is inside the Tauri webview.
    console: true
  },
  routes: { "/*": index }
})

console.log(`editor: ${server.url}`)
