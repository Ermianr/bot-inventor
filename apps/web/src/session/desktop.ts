/**
 * Whether the editor is running inside the desktop shell.
 *
 * The Canvas is the whole application to look at, and it runs in a plain
 * browser — during development, and under the end-to-end tests. The Tauri side
 * is not there then, and asking it to listen for a Session's output throws on
 * the spot, which would take the editor down with it. Everything a Session
 * needs is behind this check; nothing else is.
 */
export function inDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}
