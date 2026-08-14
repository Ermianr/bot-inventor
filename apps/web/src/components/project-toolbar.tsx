import { Button } from "@bot-inventor/ui/components/button"

import { translate } from "@/i18n/messages"
import type { ProjectFileEditor } from "@/project/use-project-file"

/**
 * What the user does with their Project as a whole: start a new one, open one
 * they saved, and save the one they are on.
 *
 * It says where the Project lives and whether the file is behind, because those
 * are the two things somebody about to close the application wants to know.
 */
export function ProjectToolbar({ name, file }: { name: string; file: ProjectFileEditor }) {
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

        <span className="ml-2 font-medium text-sm">{name}</span>
        {file.saved ? null : (
          <span className="text-muted-foreground text-xs" title={translate("project.file.unsaved")}>
            {translate("project.file.unsavedMark")}
          </span>
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
    </div>
  )
}
