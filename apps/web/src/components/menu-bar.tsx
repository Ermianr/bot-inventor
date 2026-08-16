import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger
} from "@bot-inventor/ui/components/menubar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@bot-inventor/ui/components/tooltip"
import { useEffect } from "react"
import { toast } from "sonner"

import { InlineName } from "@/components/inline-name"
import { ThemeMenu } from "@/components/theme-menu"
import { useMenuShortcuts } from "@/components/use-menu-shortcuts"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"
import type { ProjectFileEditor } from "@/project/use-project-file"

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
 * Project and View live here so far. Help comes later, and the row is shaped to
 * take it.
 */
export function MenuBar({
  name,
  onRename,
  file,
  exporting
}: {
  name: string
  onRename: (name: string) => void
  file: ProjectFileEditor
  exporting: Exporting
}) {
  useMenuShortcuts({
    create: () => void file.create(),
    open: () => void file.open(),
    save: () => void file.save(),
    saveAs: () => void file.saveAs()
  })

  useAnnounce(file.problem, toast.error)
  useAnnounce(exporting.problem, toast.error)
  useAnnounce(exporting.written, toast.success)

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Menubar className="border-0 shadow-none">
        <MenubarMenu>
          <MenubarTrigger>{translate("menu.project")}</MenubarTrigger>
          <MenubarContent>
            {/*
              The shortcut is written beside the entry it belongs to, which is
              how somebody who has never been told about it learns it: they came
              to the menu for the action and leave knowing the keys. They are
              held off the label rather than sitting against it: read at a
              glance, an entry is a thing to do and the keys are an aside, and
              two words touching are read as one.
            */}
            <MenubarItem className="gap-6" onClick={() => void file.create()}>
              {translate("project.file.new")}
              <MenubarShortcut>{translate("project.file.new.shortcut")}</MenubarShortcut>
            </MenubarItem>
            <MenubarItem className="gap-6" onClick={() => void file.open()}>
              {translate("project.file.open")}
              <MenubarShortcut>{translate("project.file.open.shortcut")}</MenubarShortcut>
            </MenubarItem>
            <MenubarItem className="gap-6" onClick={() => void file.save()}>
              {translate("project.file.save")}
              <MenubarShortcut>{translate("project.file.save.shortcut")}</MenubarShortcut>
            </MenubarItem>
            <MenubarItem className="gap-6" onClick={() => void file.saveAs()}>
              {translate("project.file.saveAs")}
              <MenubarShortcut>{translate("project.file.saveAs.shortcut")}</MenubarShortcut>
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
          The theme is the only setting the application has, so it is a menu
          entry rather than a preferences dialog. When the second one arrives —
          the language — both move into a dialog together.
        */}
        <MenubarMenu>
          <MenubarTrigger data-testid="menu-view">{translate("menu.view")}</MenubarTrigger>
          <MenubarContent>
            <ThemeMenu />
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      {/*
        Where the Project is saved is what somebody about to close the
        application wants, and not what they need while working: it hangs off
        the name rather than taking a piece of the row for good.
      */}
      <InlineName
        name={name}
        className="font-medium text-sm"
        editLabel={translate("project.name.edit")}
        fieldLabel={translate("project.name.field")}
        testId="project-name"
        hint={
          file.path === undefined
            ? translate("project.file.nowhere")
            : translate("project.file.location", { path: file.path })
        }
        onRename={onRename}
      />

      {file.saved ? null : (
        // The mark is a word wide, so what it means is said by the editor's own
        // tooltip rather than the operating system's `title`: that one arrives
        // late and in a typeface from nowhere in this app.
        <Tooltip>
          <TooltipTrigger
            render={<span />}
            // The whole sentence, and not only the word the mark shows: the
            // accessible name carries it for anyone who cannot see the tooltip.
            aria-label={translate("project.file.unsaved")}
            className="text-muted-foreground text-xs"
            data-testid="project-unsaved"
          >
            {translate("project.file.unsavedMark")}
          </TooltipTrigger>
          <TooltipContent>{translate("project.file.unsaved")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * Shows a sentence the moment it appears, and says nothing while there is none.
 *
 * The hooks underneath hold what they have to say until the next thing the user
 * asks for, so the message going from absent to present is the event, and that
 * is what a toast is raised on.
 */
function useAnnounce(message: string | undefined, show: (message: string) => void) {
  useEffect(() => {
    if (message === undefined) return
    show(message)
  }, [message, show])
}
