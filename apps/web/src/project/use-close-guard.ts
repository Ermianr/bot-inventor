import { useEffect, useRef } from "react"

import { inDesktopShell } from "@/session/desktop"

/**
 * Closing the application asks first, when there is something to lose.
 *
 * The window is the one way out of the editor that the editor does not draw, so
 * it is the one place unsaved work could disappear without anybody being asked.
 * Outside the desktop shell there is no window to hold on to and this does
 * nothing: a browser tab is not what the user's work lives in.
 */
export function useCloseGuard(mayClose: () => Promise<boolean>): void {
  // The listener is registered once and outlives every render, so it reads the
  // answer through a ref rather than closing over the first one it was given.
  const latest = useRef(mayClose)
  latest.current = mayClose

  useEffect(() => {
    if (!inDesktopShell()) return

    let stopListening: (() => void) | undefined
    let stopped = false

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const window = getCurrentWindow()

      const unlisten = await window.onCloseRequested(async event => {
        if (await latest.current()) return
        event.preventDefault()
      })

      if (stopped) unlisten()
      else stopListening = unlisten
    })()

    return () => {
      stopped = true
      stopListening?.()
    }
  }, [])
}
