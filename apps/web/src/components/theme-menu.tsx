import {
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger
} from "@bot-inventor/ui/components/menubar"

import { useTheme } from "@/components/theme-provider"
import { translate } from "@/i18n/messages"

/**
 * The three answers the user can give to what the application should look like,
 * each with the words it is offered in.
 */
const THEMES = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system"
} as const

type Theme = keyof typeof THEMES

/** Whether the menu handed back one of the three, rather than anything else. */
function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && value in THEMES
}

/**
 * Theme, as it hangs under View.
 *
 * It is a radio group rather than three entries, because the three are one
 * answer and the user has to be able to see which one is theirs without
 * changing it to find out. Remembering the choice is `next-themes`' job, and
 * has been since before this menu existed.
 */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme()

  return (
    <MenubarSub>
      <MenubarSubTrigger data-testid="menu-theme">{translate("theme.title")}</MenubarSubTrigger>
      <MenubarSubContent>
        <MenubarRadioGroup
          // `useTheme` types the choice as possibly absent, for the render that
          // happens before there is a browser to read one from. There is no
          // such render here, and nothing marked is better than the wrong one
          // marked if that ever changes.
          value={theme ?? ""}
          // The menu hands values back untyped, and this is the one door a
          // theme the application does not have could come through.
          onValueChange={next => {
            if (isTheme(next)) setTheme(next)
          }}
        >
          {Object.entries(THEMES).map(([choice, label]) => (
            <MenubarRadioItem
              key={choice}
              value={choice}
              // A radio item leaves the menu open by default, which is what a
              // list of things to tick wants and not what this is: the choice
              // is made once and the whole menu has served its purpose.
              closeOnClick
              data-testid={`theme-${choice}`}
            >
              {translate(label)}
            </MenubarRadioItem>
          ))}
        </MenubarRadioGroup>
      </MenubarSubContent>
    </MenubarSub>
  )
}
