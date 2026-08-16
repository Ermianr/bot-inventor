import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger
} from "@bot-inventor/ui/components/menubar"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { AboutDialog } from "@/components/about-dialog"
import { InlineName } from "@/components/inline-name"
import { MinimapMenuItem } from "@/components/minimap-menu"
import { ThemeMenu } from "@/components/theme-menu"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"

/**
 * The Menu Bar: the one row that holds what the user does with the Project as a
 * whole, rather than with any single Flow.
 *
 * Everything an action has to say back — a file that would not open, an export
 * that failed, an export that was written — is said in a toast. A line of text
 * inside the row pushed the row around as it appeared and went unread when it
 * did not; a toast arrives where the user is already looking and leaves on its
 * own.
 *
 * Project, View and Help live here.
 *
 * There is no Save, and no New or Open either. The application owns where
 * Projects live (ADR 0009): work saves itself, and another Project is reached
 * by going back to the Dashboard rather than through a file dialog.
 */
export function MenuBar({
  name,
  onRename,
  onDashboard,
  saved,
  problem,
  exporting
}: {
  name: string
  onRename: (name: string) => void
  /** Takes the user back to the Dashboard. The route knows where that is. */
  onDashboard: () => void
  /**
   * Whether everything on the Canvas has reached storage.
   *
   * It is not drawn. Nothing the user could do about it exists any more, and a
   * word appearing and going on its own every time anything is typed is noise
   * about a promise the editor already keeps. It is on the row as an attribute
   * because autosave is the only thing that knows it, and an end-to-end spec
   * asking "is my work safe yet" has nothing else to read.
   */
  saved: boolean
  /** Why the last write did not happen, when it did not. */
  problem: string | undefined
  exporting: Exporting
}) {
  const [aboutOpen, setAboutOpen] = useState(false)

  useAnnounce(problem, toast.error)
  useAnnounce(exporting.problem, toast.error)

  // Where the Export went is the one message that has something to do about it,
  // and the moment to do it is while the toast is still up: this is what the
  // user wanted the Export for.
  const showWritten = exporting.showWritten
  useAnnounce(exporting.written, message =>
    toast.success(
      message,
      showWritten === undefined
        ? undefined
        : { action: { label: translate("export.show"), onClick: () => void showWritten() } }
    )
  )

  return (
    <div className="flex items-center gap-2 border-b px-3 py-1" data-saved={saved}>
      {/*
        The row is the thinnest thing in the window on purpose: every pixel it
        takes is a pixel the Canvas does not have, and nothing in it is read
        for longer than it takes to click.
      */}
      <Menubar className="h-8 border-0 shadow-none">
        <MenubarMenu>
          <MenubarTrigger data-testid="menu-project">{translate("menu.project")}</MenubarTrigger>
          <MenubarContent>
            {/*
              The way back to every other Project, and the way to open a second
              one: with the application owning where Projects live, there is
              nothing else New and Open were for.
            */}
            <MenubarItem data-testid="menu-dashboard" onClick={onDashboard}>
              {translate("menu.project.dashboard")}
            </MenubarItem>

            {/*
              Both formats are offered together rather than behind a setting,
              because which one a user wants is not a preference — it is what
              they are about to do with the bot, and the line under each is the
              whole of what somebody who does not program has to choose with.
            */}
            <MenubarSub>
              <MenubarSubTrigger disabled={exporting.busy}>
                {exporting.busy ? translate("export.working") : translate("export.title")}
              </MenubarSubTrigger>
              <MenubarSubContent className="max-w-80">
                <MenubarItem
                  className="flex-col items-start gap-0.5"
                  onClick={() => void exporting.exportAs("single-file")}
                >
                  <span className="font-medium">{translate("export.singleFile")}</span>
                  <span className="text-muted-foreground text-xs">
                    {translate("export.singleFile.help")}
                  </span>
                </MenubarItem>

                <MenubarItem
                  className="flex-col items-start gap-0.5"
                  onClick={() => void exporting.exportAs("node-project")}
                >
                  <span className="font-medium">{translate("export.nodeProject")}</span>
                  <span className="text-muted-foreground text-xs">
                    {translate("export.nodeProject.help")}
                  </span>
                </MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
          </MenubarContent>
        </MenubarMenu>

        {/*
          What the editor shows the user, and what it looks like while it does.
          Both are the person's own preference rather than the bot's, and
          neither is ever written into a Project File: opening somebody else's
          bot must not rearrange your editor.
        */}
        <MenubarMenu>
          <MenubarTrigger data-testid="menu-view">{translate("menu.view")}</MenubarTrigger>
          <MenubarContent>
            <MinimapMenuItem />
            <ThemeMenu />
          </MenubarContent>
        </MenubarMenu>

        {/*
          Help holds one entry, and About is the whole of what this application
          has to say about itself: a user who is asked what they are running has
          nowhere else to look.
        */}
        <MenubarMenu>
          <MenubarTrigger data-testid="menu-help">{translate("menu.help")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem data-testid="menu-about" onClick={() => setAboutOpen(true)}>
              {translate("about.menu")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/*
        The dialog is a sibling of the menu rather than a child of it: the menu
        is gone the moment the entry is clicked, and it would take the dialog
        with it.
      */}
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <InlineName
        name={name}
        className="font-medium text-sm"
        editLabel={translate("project.name.edit")}
        fieldLabel={translate("project.name.field")}
        testId="project-name"
        onRename={onRename}
      />
    </div>
  )
}

/**
 * Shows a sentence the moment it appears, and says nothing while there is none.
 *
 * The hooks underneath hold what they have to say until the next thing the user
 * asks for, so the message going from absent to present is the event, and that
 * is what a toast is raised on.
 *
 * The message alone is that event. How it is shown is read when it happens and
 * never watched, so that a caller may build one on the spot — a toast that
 * carries something to press has to — without every render raising it again.
 */
function useAnnounce(message: string | undefined, show: (message: string) => void) {
  const latest = useRef(show)
  latest.current = show

  useEffect(() => {
    if (message === undefined) return
    latest.current(message)
  }, [message])
}
