import { Button } from "@bot-inventor/ui/components/button"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { InlineName } from "@/components/inline-name"
import { translate } from "@/i18n/messages"
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
 * something is part of making it rather than a second thing to remember.
 */
export function FlowList({ editor }: { editor: ProjectEditor }) {
  /**
   * The Flow that was just created, so its row opens on its name. Which Flow it
   * was is remembered rather than a plain flag, because the list is redrawn for
   * every edit and only that one row starts as a field.
   */
  const [created, setCreated] = useState<string | undefined>(undefined)

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
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                open ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
            >
              <InlineName
                name={flow.name}
                className="w-full"
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
            </li>
          )
        })}
      </ul>
    </nav>
  )
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
