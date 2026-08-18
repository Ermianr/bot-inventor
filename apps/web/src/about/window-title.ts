import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect } from "react"

import { APPLICATION_NAME } from "@/about/application"
import { inDesktopShell } from "@/session/desktop"

/**
 * What the window's title bar says.
 *
 * The product's name is always in it, because a window in the task bar has to
 * be recognisable as this application; the open Project goes in front of it,
 * because that is what the user came to the window for. Neither half is
 * translated: one is a product name and the other is the name the user typed.
 */

/** The title for a Project, or for the application with none open. */
export function windowTitle(projectName?: string): string {
  const named = projectName?.trim()
  return named ? `${named} — ${APPLICATION_NAME}` : APPLICATION_NAME
}

/**
 * Keeps the window's title on the Project that is open, renames and all.
 *
 * The Tauri window and the document are two different titles, so both are set:
 * the first is what the desktop shell shows, the second is what a plain browser
 * shows during development and under the end-to-end tests.
 */
export function useWindowTitle(projectName?: string): void {
  useEffect(() => {
    const title = windowTitle(projectName)

    if (typeof document !== "undefined") document.title = title

    // Nothing depends on the title being set, and a window that has already
    // gone is the ordinary way this fails, so a refusal is left where it is.
    if (inDesktopShell())
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {})
  }, [projectName])
}
