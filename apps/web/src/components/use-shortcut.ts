import { useEffect, useEffectEvent } from "react"

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

/**
 * A shortcut as it is written down — `F5`, `Shift+F5` — which is both what is
 * listened for and what the tooltip beside the control shows. The key is the
 * one the keyboard reports, and `Shift+` in front of it is the one modifier the
 * editor claims for itself.
 */
export type Shortcut = string

/**
 * Runs `act` when the shortcut is pressed, unless `enabled` is false.
 *
 * `enabled` is the same condition that disables the button, rather than a
 * separate one: a shortcut that fires while its control is dead is a control
 * that lied about what pressing it would do. It stops the shortcut acting and
 * not the editor claiming the key — the browser's own answer to it is never
 * what the user wanted either.
 */
export function useShortcut(shortcut: Shortcut, act: () => void, enabled = true) {
  // What to do is read when the key is pressed and never watched, so a caller
  // may pass a fresh closure every render — they all do — without the listener
  // being taken off the window and put back on it each time.
  const run = useEffectEvent(act)

  useEffect(() => {
    const shift = shortcut.startsWith("Shift+")
    const key = shift ? shortcut.slice("Shift+".length) : shortcut

    const listen = (event: KeyboardEvent) => {
      if (event.key !== key) return
      if (event.shiftKey !== shift) return
      // The other modifiers are not ours: a browser or an operating system
      // shortcut that happens to share the key stays theirs.
      if (event.ctrlKey || event.altKey || event.metaKey) return

      // Swallowed whether or not it does anything, and however long it is held.
      // A shortcut the editor has claimed stays claimed while it is dead: F5
      // falling through to the browser reloads the window and the Session goes
      // with it, which is what would happen while a bot is running — the one
      // moment it costs the user everything.
      event.preventDefault()

      if (!enabled) return
      // Held down, a key repeats. One press is one Session.
      if (event.repeat) return

      run()
    }

    window.addEventListener("keydown", listen)
    return () => window.removeEventListener("keydown", listen)
  }, [shortcut, enabled])
}
