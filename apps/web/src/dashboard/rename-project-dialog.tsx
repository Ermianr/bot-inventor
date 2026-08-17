import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"
import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"
import { useEffect, useState } from "react"

import { translate } from "@/i18n/messages"
import type { ProjectSummary } from "@/project/project-store"

/**
 * What a Project is called, and nothing else.
 *
 * Renaming lives here rather than in the editor: a name is what tells one card
 * from another, so it is changed where the cards are, and there is exactly one
 * place in the application that does it.
 *
 * The field starts on the name the Project has, because renaming is usually
 * fixing what was typed in a hurry rather than inventing something new — and it
 * is reset every time the dialog opens, so a rename that was abandoned does not
 * come back as a suggestion for a different Project.
 */
export function RenameProjectDialog({
  project,
  problem,
  onOpenChange,
  onRename
}: {
  /** The Project being renamed, or nothing when nobody is renaming one. */
  project: ProjectSummary | undefined
  /** Why the last attempt did not rename it, when it did not. */
  problem: string | undefined
  onOpenChange: (open: boolean) => void
  onRename: (name: string) => void
}) {
  const [name, setName] = useState("")

  useEffect(() => {
    if (project !== undefined) setName(project.name)
  }, [project])

  return (
    <Dialog open={project !== undefined} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rename-project-dialog">
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            onRename(name)
          }}
        >
          <DialogHeader>
            <DialogTitle>{translate("dashboard.rename.title")}</DialogTitle>
            <DialogDescription>{translate("dashboard.rename.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="rename-project-name">{translate("dashboard.rename.name")}</Label>
            <Input
              id="rename-project-name"
              data-testid="rename-project-name"
              // The user came to type a name: the cursor is already there, on
              // the name they are about to replace.
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
            />
          </div>

          {problem === undefined ? null : (
            <p className="text-destructive text-sm" data-testid="rename-project-problem">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              {translate("dashboard.rename.cancel")}
            </Button>
            <Button type="submit" data-testid="rename-project-confirm">
              {translate("dashboard.rename.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
