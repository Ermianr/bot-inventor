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
 */
export function FlowList({ editor }: { editor: ProjectEditor }) {
  return (
    <nav aria-label={translate("flows.title")} className="grid gap-1 p-2">
      <p className="px-2 py-1 font-medium text-muted-foreground text-xs uppercase">
        {translate("flows.title")}
      </p>
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
                  open
                    ? undefined
                    : "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                }
                testId={`flow-${flow.id}`}
                onSelect={() => editor.openFlow(flow.id)}
                onRename={name => rename(editor, flow.id, name)}
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
function rename(editor: ProjectEditor, flowId: string, name: string): boolean {
  const result = editor.renameFlow(flowId, name)
  if (result.renamed) return true

  if (result.refusal === "duplicate") toast.error(translate("flows.name.taken", { name }))
  return false
}
