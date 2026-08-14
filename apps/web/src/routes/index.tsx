import { createFileRoute } from "@tanstack/react-router"

import { Canvas } from "@/canvas/canvas"
import { FlowList } from "@/canvas/flow-list"
import { RunPanel } from "@/components/run-panel"
import { useProject } from "@/project/use-project"
import { currentProject } from "@/session/current-project"

export const Route = createFileRoute("/")({
  component: HomeComponent
})

/**
 * The editor: the Flows on the left, the one being edited in the middle, and
 * running it on the right. The Canvas takes the room, because it is what the
 * user came here to look at.
 */
function HomeComponent() {
  const editor = useProject(currentProject)

  return (
    <div className="grid h-full grid-cols-[14rem_1fr_24rem] overflow-hidden">
      <aside className="overflow-y-auto border-r">
        <FlowList editor={editor} />
      </aside>

      <main className="h-full">
        <Canvas editor={editor} />
      </main>

      <aside className="overflow-y-auto border-l p-4">
        <RunPanel project={editor.project} />
      </aside>
    </div>
  )
}
