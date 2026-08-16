import { Button } from "@bot-inventor/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@bot-inventor/ui/components/tooltip"

import { ExportButton } from "@/components/export-button"
import { InlineName } from "@/components/inline-name"
import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"
import type { ProjectFileEditor } from "@/project/use-project-file"

/**
 * What the user does with their Project as a whole: start a new one, open one
 * they saved, save the one they are on, and take it away as code that runs
 * without Bot Inventor.
 *
 * It says where the Project lives and whether the file is behind, because those
 * are the two things somebody about to close the application wants to know.
 */
export function ProjectToolbar({
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
  return (
    <div className="flex flex-col gap-1 border-b px-3 py-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void file.create()}>
          {translate("project.file.new")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void file.open()}>
          {translate("project.file.open")}
        </Button>
        <Button size="sm" onClick={() => void file.save()}>
          {translate("project.file.save")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void file.saveAs()}>
          {translate("project.file.saveAs")}
        </Button>
        <ExportButton exporting={exporting} />

        <InlineName
          name={name}
          className="ml-2 font-medium text-sm"
          editLabel={translate("project.name.edit")}
          fieldLabel={translate("project.name.field")}
          testId="project-name"
          onRename={onRename}
        />
        {file.saved ? null : (
          // The mark is a character wide, so what it means is said by the
          // editor's own tooltip rather than the operating system's `title`:
          // that one arrives late and in a typeface from nowhere in this app.
          <Tooltip>
            <TooltipTrigger
              render={<span />}
              // The whole sentence, and not only the word the mark shows: the
              // `title` that went used to carry it for anyone who could not
              // see the tooltip, and the accessible name carries it now.
              aria-label={translate("project.file.unsaved")}
              className="text-muted-foreground text-xs"
              data-testid="project-unsaved"
            >
              {translate("project.file.unsavedMark")}
            </TooltipTrigger>
            <TooltipContent>{translate("project.file.unsaved")}</TooltipContent>
          </Tooltip>
        )}

        <span className="ml-auto truncate text-muted-foreground text-xs">
          {file.path === undefined
            ? translate("project.file.nowhere")
            : translate("project.file.location", { path: file.path })}
        </span>
      </div>

      {file.problem === undefined ? null : (
        <p role="alert" className="text-destructive text-xs">
          {file.problem}
        </p>
      )}

      {exporting.problem === undefined ? null : (
        <p role="alert" className="text-destructive text-xs">
          {exporting.problem}
        </p>
      )}

      {exporting.written === undefined ? null : (
        <p role="status" className="text-muted-foreground text-xs">
          {exporting.written}
        </p>
      )}
    </div>
  )
}
