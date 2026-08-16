// @vitest-environment jsdom

import {
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarTrigger
} from "@bot-inventor/ui/components/menubar"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ThemeMenu } from "@/components/theme-menu"
import { THEME_STORAGE_KEY, ThemeProvider } from "@/components/theme-provider"
import { translate } from "@/i18n/messages"

/**
 * Choosing the theme from View ▸ Theme.
 *
 * The menu is held to what the user can see happen: the class the page is
 * painted through changes, the choice is written where it survives a restart,
 * and the entry that is theirs is the one marked. Whether the radio group was
 * wired to the right handler at all is the thing no test of `next-themes`
 * underneath it can catch.
 */

// `next-themes` asks the browser what the operating system prefers, and jsdom
// has no answer to that question at all.
beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ""
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as unknown as MediaQueryList
})

afterEach(cleanup)

/** The menu as the root route puts it together, opened the way a user opens it. */
function openViewMenu() {
  render(
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey={THEME_STORAGE_KEY}>
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>{translate("menu.view")}</MenubarTrigger>
          <MenubarContent>
            <ThemeMenu />
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </ThemeProvider>
  )

  fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.view") }))
}

/** Clicks the entry showing that label, once a menu holding it is open. */
async function pick(label: string) {
  const item = await screen.findByText(label)
  await act(async () => {
    fireEvent.click(item)
  })
}

describe("View ▸ Theme", () => {
  for (const [choice, key] of [
    ["light", "theme.light"],
    ["dark", "theme.dark"]
  ] as const) {
    it(`paints the application ${choice} the moment it is picked`, async () => {
      openViewMenu()
      await pick(translate("theme.title"))
      await pick(translate(key))

      expect(document.documentElement.classList.contains(choice)).toBe(true)
    })
  }

  it("remembers the choice where a restart still finds it", async () => {
    openViewMenu()
    await pick(translate("theme.title"))
    await pick(translate("theme.light"))

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light")
  })

  it("offers following the operating system as one of the three", async () => {
    openViewMenu()
    await pick(translate("theme.title"))
    await pick(translate("theme.system"))

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system")
  })

  it("shows which theme is the one in use", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light")

    openViewMenu()
    await pick(translate("theme.title"))

    const chosen = await screen.findByRole("menuitemradio", { name: translate("theme.light") })
    expect(chosen.getAttribute("aria-checked")).toBe("true")
  })
})
