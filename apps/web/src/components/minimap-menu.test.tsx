import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import {
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarTrigger
} from "@bot-inventor/ui/components/menubar"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { MinimapMenuItem } from "@/components/minimap-menu"
import { translate } from "@/i18n/messages"
import { MINIMAP_STORAGE_KEY } from "@/preferences/minimap"

/**
 * Turning the Minimap on and off from View ▸ Minimap.
 *
 * What the preference does is covered where the preference is. What only this
 * can be held to is that the entry is wired to it at all, and that it shows the
 * user which way it is now: a tick that never moves is the interface lying.
 */

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(cleanup)

/** The menu as the Menu Bar puts it together, opened the way a user opens it. */
function openViewMenu() {
  render(
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>{translate("menu.view")}</MenubarTrigger>
        <MenubarContent>
          <MinimapMenuItem />
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )

  fireEvent.click(screen.getByRole("menuitem", { name: translate("menu.view") }))
}

/** The entry itself, once the menu holding it is open. */
function entry() {
  return screen.findByRole("menuitemcheckbox", { name: translate("minimap.title") })
}

describe("View ▸ Minimap", () => {
  it("is ticked while the Minimap is shown", async () => {
    openViewMenu()

    expect((await entry()).getAttribute("aria-checked")).toBe("true")
  })

  it("hides the Minimap when it is unticked", async () => {
    openViewMenu()

    fireEvent.click(await entry())

    expect(window.localStorage.getItem(MINIMAP_STORAGE_KEY)).toBe("hidden")
  })

  it("is not ticked while the Minimap is hidden, and shows it again when it is", async () => {
    window.localStorage.setItem(MINIMAP_STORAGE_KEY, "hidden")
    openViewMenu()

    expect((await entry()).getAttribute("aria-checked")).toBe("false")

    fireEvent.click(await entry())

    expect(window.localStorage.getItem(MINIMAP_STORAGE_KEY)).toBe("shown")
  })
})
