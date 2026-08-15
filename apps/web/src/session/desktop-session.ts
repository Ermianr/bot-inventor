import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { inDesktopShell } from "@/session/desktop"
import { EXIT_EVENT, OUTPUT_EVENT } from "@/session/events"
import type { Refusal } from "@/session/refusal"
import type { SessionGateway } from "@/session/session-gateway"

/**
 * Running a bot through the desktop shell.
 *
 * Compiling happens above this, in the webview, because it is a pure function of
 * the Project; everything from the process onwards is Tauri's, and this is the
 * whole of what the editor says to it.
 */
const desktopSession: SessionGateway = {
  start: async request => {
    await invoke("start_session", request)
  },

  stop: async () => {
    await invoke("stop_session")
  },

  onOutput: forward => subscribe(OUTPUT_EVENT, forward),
  onExit: forward => subscribe(EXIT_EVENT, forward)
}

/**
 * A shell that will not run anything, for the plain browser the Canvas also
 * runs in — during development, and under the end-to-end tests.
 *
 * Pressing Run there says so rather than throwing somewhere the user never
 * sees. Nothing else about the editor changes: the Canvas is the application,
 * and it works without a bot behind it.
 */
const noSession: SessionGateway = {
  // A refusal rather than an error, because it is one: the panel already knows
  // how to put every other refusal in front of the user, in their language.
  start: () => Promise.reject({ kind: "no-desktop" } satisfies Refusal),
  stop: () => Promise.resolve(),
  onOutput: () => () => {},
  onExit: () => () => {}
}

/** Whichever of the two this build is actually running in. */
export function sessionGateway(): SessionGateway {
  return inDesktopShell() ? desktopSession : noSession
}

/**
 * Tauri hands back the way to stop listening in a promise, and the editor wants
 * it now. Unsubscribing before it arrives has to hold: an effect that is torn
 * down on the same tick it was set up would otherwise keep listening forever.
 */
function subscribe<Event>(name: string, forward: (event: Event) => void): () => void {
  let listening = true

  const attached = listen<Event>(name, event => {
    if (listening) forward(event.payload)
  })

  return () => {
    listening = false
    attached.then(remove => remove()).catch(() => {})
  }
}
