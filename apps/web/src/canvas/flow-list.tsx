import { translate } from "@/i18n/messages"
import type { ProjectEditor } from "@/project/use-project"

/**
 * The Flows of the Project, and which one the Canvas is showing.
 *
 * There is one Flow so far. The list is here anyway: the place a Flow is chosen
 * from decides the shape of the whole editor, and adding it once there are
 * several means moving everything else.
 */
export function FlowList({ editor }: { editor: ProjectEditor }) {
  return (
    <nav aria-label={translate("flows.title")} className="grid gap-1 p-2">
      <p className="px-2 py-1 font-medium text-muted-foreground text-xs uppercase">
        {translate("flows.title")}
      </p>
      <ul className="grid gap-1">
        {editor.project.flows.map(flow => (
          <li key={flow.id}>
            <button
              aria-current={flow.id === editor.flow.id}
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                flow.id === editor.flow.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              }`}
              data-testid={`flow-${flow.id}`}
              onClick={() => editor.openFlow(flow.id)}
              type="button"
            >
              {flow.name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
