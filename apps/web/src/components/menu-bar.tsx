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
import { Tooltip, TooltipContent, TooltipTrigger } from "@bot-inventor/ui/components/tooltip"
import { useEffect } from "react"
import { toast } from "sonner"

import { InlineName } from "@/components/inline-name"
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
 * Only the Project menu lives here so far. View and Help come later, and the
 * row is shaped to take them.
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
  useAnnounce(file.problem, toast.error)
  useAnnounce(exporting.problem, toast.error)
  useAnnounce(exporting.written, toast.success)

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Menubar className="border-0 shadow-none">
        <MenubarMenu>
          <MenubarTrigger>{translate("menu.project")}</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={() => void file.create()}>
              {translate("project.file.new")}
            </MenubarItem>
            <MenubarItem onClick={() => void file.open()}>
              {translate("project.file.open")}
            </MenubarItem>
            <MenubarItem onClick={() => void file.save()}>
              {translate("project.file.save")}
            </MenubarItem>
            <MenubarItem onClick={() => void file.saveAs()}>
              {translate("project.file.saveAs")}
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
      </Menubar>

      {/*
        Where the Project is saved is what somebody about to close the
        application wants, and not what they need while working: it is on the
        name rather than taking a piece of the row for good.
      */}
      <Tooltip>
        <TooltipTrigger render={<span />}>
          <InlineName
            name={name}
            className="font-medium text-sm"
            editLabel={translate("project.name.edit")}
            fieldLabel={translate("project.name.field")}
            testId="project-name"
            onRename={onRename}
          />
        </TooltipTrigger>
        <TooltipContent>
          {file.path === undefined
            ? translate("project.file.nowhere")
            : translate("project.file.location", { path: file.path })}
        </TooltipContent>
      </Tooltip>

      {file.saved ? null : (
        // The mark is a word wide, so what it means is said by the editor's own
        // tooltip rather than the operating system's `title`: that one arrives
        // late and in a typeface from nowhere in this app.
        <Tooltip>
          <TooltipTrigger
            render={<span />}
            // The whole sentence, and not only the word the mark shows: the
            // `title` that went used to carry it for anyone who could not see
            // the tooltip, and the accessible name carries it now.
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
