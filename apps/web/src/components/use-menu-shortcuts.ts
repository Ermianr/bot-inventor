import { useEffect, useRef } from "react"

/** What the keyboard can ask for, named after the Menu Bar entry it belongs to. */
export type MenuActions = {
  create: () => void
  open: () => void
  save: () => void
  saveAs: () => void
}

type Shortcut = {
  action: keyof MenuActions
  /** The key as `KeyboardEvent.key` reads it, lowercased. */
  key: string
  shift: boolean
  /**
   * Whether the shortcut still fires while the user is typing. Only Save does:
   * somebody halfway through naming their bot reaching for Ctrl+S means to
   * save, and a shortcut that goes quiet there is the one moment it is most
   * needed. New, Open and Save as… would throw away or interrupt what is being
   * typed, so a stray Ctrl+N inside a field does nothing.
   */
  whileTyping: boolean
}

/**
 * The keys drawn beside the Project menu's entries, in the order the menu
 * shows them. The label the user reads lives in the message catalogue; this is
 * the same shortcut said in the terms the browser reports it.
 */
const SHORTCUTS: readonly Shortcut[] = [
  { action: "create", key: "n", shift: false, whileTyping: false },
  { action: "open", key: "o", shift: false, whileTyping: false },
  { action: "save", key: "s", shift: false, whileTyping: true },
  { action: "saveAs", key: "s", shift: true, whileTyping: false }
]

/**
 * Makes the Project menu's shortcuts do from the keyboard what the menu does
 * from the pointer.
 *
 * The listener is on the window rather than on the row: the Canvas fills the
 * screen and takes the focus, so a shortcut bound to the Menu Bar's own subtree
 * would only work while the menu already had the focus — which is to say never,
 * since a shortcut is what the user reaches for instead of opening the menu.
 */
export function useMenuShortcuts(actions: MenuActions) {
  // The actions are rebuilt on every render of whoever holds the Project, and
  // resubscribing the window on each of them would drop a key press landing in
  // between. The listener reads the latest set instead of closing over one.
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Alt turns any of these into a different shortcut altogether. Ctrl is
      // the only modifier this one answers to: the application ships as a
      // Windows desktop app, and the menu says Ctrl in every entry.
      if (!event.ctrlKey || event.altKey) return

      const shortcut = SHORTCUTS.find(
        candidate => candidate.key === event.key.toLowerCase() && candidate.shift === event.shiftKey
      )
      if (shortcut === undefined) return

      const field = writingIn(event.target)
      if (field !== undefined && !shortcut.whileTyping) return

      // Ctrl+O and Ctrl+S are the browser's own before they are ours, and in
      // the desktop shell they are nothing at all — stopping them is what keeps
      // `dev:web` from opening a file picker over the editor.
      event.preventDefault()

      if (field === undefined) {
        latest.current[shortcut.action]()
        return
      }

      // Saving from inside a field has to write what is in the field. The name
      // the user is typing is only handed over when the field loses the focus,
      // so the focus goes first and the Project is read afterwards — a Save
      // that stored the name from one keystroke ago is the edit the user
      // reached for Ctrl+S to keep, quietly thrown away.
      field.blur()
      const action = shortcut.action
      setTimeout(() => latest.current[action]())
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}

/** The text field the key press landed in, if it landed in one at all. */
function writingIn(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof HTMLElement)) return undefined
  if (target.isContentEditable) return target
  return ["INPUT", "TEXTAREA"].includes(target.tagName) ? target : undefined
}
