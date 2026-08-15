import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { InlineName } from "@/components/inline-name"
import { translate } from "@/i18n/messages"
import { canRemoveFlow } from "@/project/edits"
import type { ProjectEditor } from "@/project/use-project"

/**
 * The Flows of the Project, which one the Canvas is showing, and what each one
 * is called.
 *
 * A row is chosen by its name and renamed by the pencil beside it, the same
 * gesture the Project name uses. The pencil is out of the way until the row is
 * hovered or the keyboard reaches it, except on the Flow that is open: that one
 * is where the user already is.
 *
 * The "+" adds a Flow and hands the user its name as a field, so calling it
 * something is part of making it rather than a second thing to remember. The
 * bin beside the pencil takes one away, always asking first: there is no undo.
 */
export function FlowList({ editor }: { editor: ProjectEditor }) {
  /**
   * The Flow that was just created, so its row opens on its name. Which Flow it
   * was is remembered rather than a plain flag, because the list is redrawn for
   * every edit and only that one row starts as a field.
   */
  const [created, setCreated] = useState<string | undefined>(undefined)

  /**
   * The Flow the confirmation is asking about. The Flow itself is held rather
   * than its id, so the question can keep naming it while the dialog closes on
   * the Flow that is no longer in the Project.
   */
  const [removing, setRemoving] = useState<{ id: string; name: string } | undefined>(undefined)

  return (
    <nav aria-label={translate("flows.title")} className="grid gap-1 p-2">
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <p className="font-medium text-muted-foreground text-xs uppercase">
          {translate("flows.title")}
        </p>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={translate("flows.create")}
          data-testid="flow-create"
          onClick={() => setCreated(editor.createFlow())}
        >
          <PlusIcon />
        </Button>
      </div>
      <ul className="grid gap-1">
        {editor.project.flows.map(flow => {
          const open = flow.id === editor.flow.id

          return (
            <li
              key={flow.id}
              aria-current={open}
              // `group` is what lets the pencil below appear for the whole row
              // rather than only when the pointer is on the pencil itself.
              // The pencil and the bin are one cluster, with nothing between
              // them: they are what can be done to this row, and a gap makes
              // them read as two unrelated controls that happen to be near
              // each other.
              className={`group flex items-center rounded-md py-1.5 pr-1 pl-2 text-sm ${
                open ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
            >
              <InlineName
                name={flow.name}
                className="w-full gap-0"
                editLabel={translate("flows.name.edit")}
                fieldLabel={translate("flows.name.field")}
                editClassName={
                  // Hidden rather than merely transparent: a pencil nobody can
                  // see is not one they should be able to click by accident.
                  // The keyboard still reaches it — tabbing to the row's name
                  // is what reveals it.
                  open ? undefined : "invisible group-focus-within:visible group-hover:visible"
                }
                startEditing={flow.id === created}
                testId={`flow-${flow.id}`}
                onSelect={() => editor.openFlow(flow.id)}
                onRename={name => renameOrExplain(editor, flow.id, name)}
              />
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={translate("flows.remove")}
                data-testid={`flow-${flow.id}-remove`}
                // Hidden for the same reason the pencil is: a row is a place to
                // work, not a row of buttons. The keyboard still reaches it.
                className={
                  open ? undefined : "invisible group-focus-within:visible group-hover:visible"
                }
                onClick={() => askOrExplain(editor, flow, setRemoving)}
              >
                <Trash2Icon />
              </Button>
            </li>
          )
        })}
      </ul>
      <Dialog open={removing !== undefined} onOpenChange={open => open || setRemoving(undefined)}>
        <DialogContent showCloseButton={false} data-testid="remove-flow-dialog">
          <DialogHeader>
            <DialogTitle>
              {translate("flows.remove.title", { name: removing?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{translate("flows.remove.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="remove-flow-cancel"
              onClick={() => setRemoving(undefined)}
            >
              {translate("flows.remove.cancel")}
            </Button>
            <Button
              variant="destructive"
              data-testid="remove-flow-confirm"
              onClick={() => {
                if (removing !== undefined) removeOrExplain(editor, removing.id)
                setRemoving(undefined)
              }}
            >
              {translate("flows.remove.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}

/**
 * Asks before removing a Flow, or says why there is nothing to ask about.
 *
 * There is no undo, and a Flow can hold hours of wiring, so the question is
 * always put — even for a Flow with nothing in it, because a user who learns
 * that removing sometimes asks stops reading the question. The only Flow of a
 * Project cannot go at all, and that is said here rather than by a button the
 * user cannot press and nobody explains.
 */
function askOrExplain(
  editor: ProjectEditor,
  flow: { id: string; name: string },
  ask: (flow: { id: string; name: string }) => void
) {
  if (!canRemoveFlow(editor.project)) {
    toast.error(translate("flows.remove.last"))
    return
  }
  ask({ id: flow.id, name: flow.name })
}

/**
 * Removes a Flow once the question has been answered, and says so if the rule
 * refused after all — the Project can have changed between the bin and the
 * button, and a dialog that closes on nothing having happened is the one thing
 * a confirmation must never do.
 */
function removeOrExplain(editor: ProjectEditor, flowId: string) {
  const removal = editor.removeFlow(flowId)
  if (removal.removed || removal.refusal === "missing") return

  toast.error(translate("flows.remove.last"))
}

/**
 * Renames a Flow, saying so when the name is one of the Project's already.
 *
 * A blank name never reaches here — the control refuses that one itself — so
 * the only refusal with something to say is the duplicate, and it is said in a
 * toast because the row has no room to hold a sentence.
 */
function renameOrExplain(editor: ProjectEditor, flowId: string, name: string): boolean {
  const result = editor.renameFlow(flowId, name)
  if (result.renamed) return true

  if (result.refusal === "duplicate") toast.error(translate("flows.name.taken", { name }))
  return false
}
