import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"

import { translate } from "@/i18n/messages"
import type { ProjectSummary } from "@/project/project-store"

/**
 * The question asked before a Project goes.
 *
 * Deleting is the one thing on the Dashboard that cannot be taken back — the
 * Flows, the token in the keychain and the settings beside them all go at once
 * — so it is the one thing that asks first, and the question names the bot so
 * that the user is agreeing to the one they meant.
 *
 * There is no close button in the corner and the buttons say what they do
 * rather than yes and no: the way out of a dialog nobody wants to be in must
 * not be the ambiguous one.
 */
export function DeleteProjectDialog({
  project,
  problem,
  onOpenChange,
  onDelete
}: {
  /** The Project being deleted, or nothing when nobody is deleting one. */
  project: ProjectSummary | undefined
  /** Why the last attempt did not delete it, when it did not. */
  problem: string | undefined
  onOpenChange: (open: boolean) => void
  onDelete: () => void
}) {
  return (
    <Dialog open={project !== undefined} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} data-testid="delete-project-dialog">
        <DialogHeader>
          <DialogTitle>
            {/*
              A Project nothing could read has no name to put in the question,
              and is named here the way its card names it — the user has to be
              agreeing to the thing they clicked.
            */}
            {translate("dashboard.delete.title", {
              name:
                project === undefined || project.name.length === 0
                  ? translate("dashboard.card.unreadable")
                  : project.name
            })}
          </DialogTitle>
          <DialogDescription>{translate("dashboard.delete.body")}</DialogDescription>
        </DialogHeader>

        {problem === undefined ? null : (
          <p className="text-destructive text-sm" data-testid="delete-project-problem">
            {problem}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            data-testid="delete-project-cancel"
            onClick={() => onOpenChange(false)}
          >
            {translate("dashboard.delete.cancel")}
          </Button>
          <Button variant="destructive" data-testid="delete-project-confirm" onClick={onDelete}>
            {translate("dashboard.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
