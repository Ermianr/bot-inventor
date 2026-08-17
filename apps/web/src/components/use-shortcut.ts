import { useEffect, useRef } from "react"

/**
 * A keyboard shortcut for something the editor already draws a control for.
 *
 * Every shortcut in the editor goes through here so that there is one answer to
 * what a key press means, one place a press is swallowed before the browser
 * acts on it — F5 reloads the window otherwise, taking the Session with it —
 * and one way of writing a shortcut down. The written form is what the tooltip
 * beside the control shows, so the words the user reads and the keys the editor
 * listens for cannot drift apart.
 *
 * A shortcut is never the only way to do a thing: it is the second way to press
 * a button that is on the screen.
 */

/** A shortcut as it is written down: `F5`, `Shift+F5`. */
export type Shortcut = `${"" | "Shift+"}${string}`

/**
 * Runs `act` while the shortcut is pressed, unless `enabled` is false.
 *
 * `enabled` is the same condition that disables the button, rather than a
 * separate one: a shortcut that fires while its control is dead is a control
 * that lied about what pressing it would do.
 */
export function useShortcut(shortcut: Shortcut, act: () => void, enabled = true) {
  // What to do is read when the key is pressed and never watched, so a caller
  // may pass a fresh closure every render — they all do — without the listener
  // being taken off the window and put back on it each time.
  const latest = useRef(act)
  latest.current = act

  useEffect(() => {
    if (!enabled) return

    const shift = shortcut.startsWith("Shift+")
    const key = shift ? shortcut.slice("Shift+".length) : shortcut

    const listen = (event: KeyboardEvent) => {
      if (event.key !== key) return
      if (event.shiftKey !== shift) return
      // The other modifiers are not ours: a browser or an operating system
      // shortcut that happens to share the key stays theirs.
      if (event.ctrlKey || event.altKey || event.metaKey) return
      // Held down, a key repeats. One press is one Run.
      if (event.repeat) return

      event.preventDefault()
      latest.current()
    }

    window.addEventListener("keydown", listen)
    return () => window.removeEventListener("keydown", listen)
  }, [shortcut, enabled])
}
