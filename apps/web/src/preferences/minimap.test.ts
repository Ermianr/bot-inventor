// @vitest-environment jsdom

import { helloProject } from "@bot-inventor/schema/fixtures"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { MINIMAP_STORAGE_KEY, useMinimap } from "@/preferences/minimap"
import { serializeProject } from "@/project/project-file"

/**
 * Whether the Minimap is shown, as the preference the editor keeps for the
 * person rather than for the bot.
 *
 * Two places read it — the Canvas that draws the Minimap and the menu entry
 * that ticks it — and they are siblings with no state between them, so what is
 * held to here is that a change in one is a change in both, and that the answer
 * outlives the run of the application it was given in.
 */

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(cleanup)

describe("whether the Minimap is shown", () => {
  it("starts shown, because a map nobody asked to hide is worth having", () => {
    const { result } = renderHook(() => useMinimap())

    expect(result.current.shown).toBe(true)
  })

  it("is hidden once the user hides it", () => {
    const { result } = renderHook(() => useMinimap())

    act(() => result.current.setShown(false))

    expect(result.current.shown).toBe(false)
  })

  it("remembers the choice where a restart still finds it", () => {
    const { result } = renderHook(() => useMinimap())

    act(() => result.current.setShown(false))

    expect(window.localStorage.getItem(MINIMAP_STORAGE_KEY)).toBe("hidden")
  })

  it("reads the choice back on the next run of the application", () => {
    window.localStorage.setItem(MINIMAP_STORAGE_KEY, "hidden")

    const { result } = renderHook(() => useMinimap())

    expect(result.current.shown).toBe(false)
  })

  /**
   * The menu and the Canvas ask separately. One of them hiding the Minimap and
   * the other carrying on drawing it is the whole failure this preference has to
   * rule out.
   */
  it("is the same answer everywhere it is asked", () => {
    const menu = renderHook(() => useMinimap())
    const canvas = renderHook(() => useMinimap())

    act(() => menu.result.current.setShown(false))

    expect(canvas.result.current.shown).toBe(false)
  })

  /**
   * The choice belongs to the person, not to the bot. A Project File holds the
   * Project and nothing else so it can be handed to somebody else as it is, and
   * a preference that found its way in would rearrange their editor when they
   * opened it.
   */
  it("stays out of the Project File", () => {
    const { result } = renderHook(() => useMinimap())
    act(() => result.current.setShown(false))

    const document = serializeProject(helloProject())

    expect(document).not.toContain("minimap")
    expect(document).not.toContain(MINIMAP_STORAGE_KEY)
  })

  /** Nothing else the application saves is the answer to this question. */
  it("is shown when what was stored is not one of the two answers", () => {
    window.localStorage.setItem(MINIMAP_STORAGE_KEY, "nonsense")

    const { result } = renderHook(() => useMinimap())

    expect(result.current.shown).toBe(true)
  })
})
