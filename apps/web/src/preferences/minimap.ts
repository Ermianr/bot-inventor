import { useSyncExternalStore } from "react"

/**
 * Whether the Minimap is shown: the user's preference, and nothing to do with
 * the bot they are building.
 *
 * It is kept beside the browser rather than in the Project, because a Project
 * File holds the Project and nothing else — opening somebody else's bot must
 * not rearrange your editor. That is the same reason the theme is kept where it
 * is, and this sits next to it for the same reason.
 *
 * The Canvas draws the Minimap and the Menu Bar ticks it, and the two are
 * siblings with nothing between them to hold state. So the store is the storage
 * itself, subscribed to rather than read once: whoever writes it, everybody
 * asking is re-rendered with the new answer, and no component has to be handed
 * the preference by a parent that has no other use for it.
 */

/**
 * Where the choice is kept between one run of the application and the next.
 * Named here rather than buried in the reader, so that a test asking whether
 * the choice survives a restart is asking about the place the application uses.
 */
export const MINIMAP_STORAGE_KEY = "bot-inventor.minimap"

/**
 * The one answer that means anything. Everything else — nothing stored yet, or
 * something stored by a version of this application that wrote it differently —
 * is the Minimap being shown, which is what a user who has never been asked
 * gets.
 */
const HIDDEN = "hidden"
const SHOWN = "shown"

/**
 * Everyone currently asking, to be told when the answer changes. The browser
 * only raises `storage` for other windows, and this application is one window:
 * a change made here has to be announced here.
 */
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readShown(): boolean {
  return window.localStorage.getItem(MINIMAP_STORAGE_KEY) !== HIDDEN
}

export type MinimapPreference = {
  shown: boolean
  setShown: (shown: boolean) => void
}

export function useMinimap(): MinimapPreference {
  const shown = useSyncExternalStore(subscribe, readShown)

  const setShown = (next: boolean) => {
    window.localStorage.setItem(MINIMAP_STORAGE_KEY, next ? SHOWN : HIDDEN)
    for (const listener of listeners) listener()
  }

  return { shown, setShown }
}
