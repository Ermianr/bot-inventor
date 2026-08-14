import { createFileRoute } from "@tanstack/react-router"

import { Canvas } from "@/canvas/canvas"
import { FlowList } from "@/canvas/flow-list"
import { ProjectToolbar } from "@/components/project-toolbar"
import { RunPanel } from "@/components/run-panel"
import { desktopProjectFiles } from "@/project/desktop-project-files"
import { initialProject } from "@/project/initial-project"
import { useCloseGuard } from "@/project/use-close-guard"
import { useProject } from "@/project/use-project"
import { useProjectFile } from "@/project/use-project-file"

export const Route = createFileRoute("/")({
  component: HomeComponent
})

/**
 * The editor: what the Project is called and where it is saved on top, the
 * Flows on the left, the one being edited in the middle, and running it on the
 * right. The Canvas takes the room, because it is what the user came here to
 * look at.
 */
function HomeComponent() {
  const editor = useProject(initialProject)
  const file = useProjectFile(editor, desktopProjectFiles)
  useCloseGuard(file.confirmDiscard)

  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
      <ProjectToolbar name={editor.project.name} file={file} />

      <div className="grid grid-cols-[14rem_1fr_24rem] overflow-hidden">
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
    </div>
  )
}
