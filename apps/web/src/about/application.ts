import { invoke } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"

import { inDesktopShell } from "@/session/desktop"

/**
 * What the application is, for Help ▸ About.
 *
 * Half of it never changes between builds and is written here — the product's
 * name, its licence, where its source is. The other half is only true of the
 * copy the user installed, and the desktop shell is the only thing that knows
 * it, so it is asked.
 */

/** The product's name, which is not translated: it is what it is called. */
export const APPLICATION_NAME = "Bot Inventor"

/** The licence the whole repository is under, as `LICENSE` spells it. */
export const LICENCE = "MIT"

/** Where the source is, for anyone who is told to go and look. */
export const REPOSITORY = "https://github.com/Ermianr/bot-inventor"

/** What only the copy running on this machine can say about itself. */
export type Application = {
  /** The version of Bot Inventor, or nothing outside the desktop shell. */
  version: string | undefined
  /** The Node.js the Sidecar runs a bot on, or nothing when it cannot be read. */
  nodeVersion: string | undefined
}

/** Nothing known, which is the whole answer in a plain browser. */
const UNKNOWN: Application = { version: undefined, nodeVersion: undefined }

/**
 * Asks the desktop shell what it is running.
 *
 * The editor also runs in a plain browser — during development and under the
 * end-to-end tests — and there is nothing to ask there. Saying so is the
 * answer: About shows what it could not find out rather than refusing to open.
 */
export async function describeApplication(): Promise<Application> {
  if (!inDesktopShell()) return UNKNOWN

  try {
    return await invoke<Application>("describe_application")
  } catch {
    // A dialog whose whole purpose is helping with a problem is the last place
    // that should fall over because of one.
    return UNKNOWN
  }
}

/**
 * The same answer, for a component: unknown until it arrives.
 *
 * It is read when it is wanted rather than when the editor starts, because
 * reading it runs the Sidecar, and nothing about the application depends on the
 * result until somebody opens About.
 */
export function useApplication(wanted: boolean): Application {
  const [application, setApplication] = useState(UNKNOWN)

  useEffect(() => {
    if (!wanted) return

    let listening = true
    void describeApplication().then(described => {
      if (listening) setApplication(described)
    })

    return () => {
      listening = false
    }
  }, [wanted])

  return application
}
