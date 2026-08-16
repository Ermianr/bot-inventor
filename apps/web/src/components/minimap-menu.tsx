import { MenubarCheckboxItem } from "@bot-inventor/ui/components/menubar"

import { translate } from "@/i18n/messages"
import { useMinimap } from "@/preferences/minimap"

/**
 * Minimap, as it hangs under View.
 *
 * It is a tick rather than two entries, because it is one thing that is either
 * on or off and the user has to be able to see which without turning it off to
 * find out. Where the answer is kept, and how it reaches the Canvas, is the
 * preference's own business.
 */
export function MinimapMenuItem() {
  const { shown, setShown } = useMinimap()

  return (
    <MenubarCheckboxItem
      checked={shown}
      // A checkbox item leaves the menu open by default, which is what a list
      // of things to tick wants and not what this is: one tick, and the menu
      // has served its purpose.
      closeOnClick
      data-testid="menu-minimap"
      onCheckedChange={setShown}
    >
      {translate("minimap.title")}
    </MenubarCheckboxItem>
  )
}
