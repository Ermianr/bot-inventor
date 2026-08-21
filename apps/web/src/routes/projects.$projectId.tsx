import type { Project } from "@bot-inventor/schema"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { useWindowTitle } from "@/about/window-title"
import { Canvas } from "@/canvas/canvas"
import { FlowList } from "@/canvas/flow-list"
import { MenuBar } from "@/components/menu-bar"
import { desktopExports } from "@/project/desktop-exports"
import { desktopShare } from "@/project/desktop-share"
import { ProjectOptionsDialog } from "@/project/project-options-dialog"
import { projectStore } from "@/project/store"
import { useExport } from "@/project/use-export"
import { useProject } from "@/project/use-project"
import { useShare } from "@/project/use-share"
import { useAutosave, useStoredProject } from "@/project/use-stored-project"
import { useTestServer } from "@/project/use-test-server"
import { Console } from "@/session/console"
import { sessionGateway } from "@/session/desktop-session"
import { RunControls } from "@/session/run-controls"
import { useSession } from "@/session/use-session"

/** Which shell this build runs a bot through. It does not change while it runs. */
const shell = sessionGateway()

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectRoute
})

/**
 * One Project, open. The id is in the route rather than in a variable, so the
 * back button goes to the Dashboard and a reload comes back to the same
 * Project.
 *
 * Loading is its own screen because the editor cannot be built without a
 * Project: the hooks that hold one have to be given it, and a Project that is
 * still being read is not something to give them.
 */
function ProjectRoute() {
  const { projectId } = Route.useParams()
  const loaded = useStoredProject(projectStore, projectId)

  if (loaded.status === "loading") return null

  if (loaded.status === "problem") {
    return (
      <div className="grid h-full place-items-center p-8">
        <p className="max-w-md text-center text-sm text-destructive" data-testid="project-problem">
          {loaded.message}
        </p>
      </div>
    )
  }

  // Keyed by the Project so that opening another one builds a fresh editor
  // rather than handing the old one's state to the new Project.
  return <Editor key={loaded.project.id} loaded={loaded.project} migrated={loaded.migrated} />
}

/**
 * The editor: the Menu Bar on top, the Flows on the left, the one being edited
 * beside them, and the Console along the bottom.
 *
 * Nothing here is saved by anybody. What is on the Canvas is what is in
 * storage, a moment behind, and the user is never asked about it.
 */
function Editor({ loaded, migrated }: { loaded: Project; migrated: boolean }) {
  const navigate = useNavigate()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const editor = useProject(() => loaded)
  const autosave = useAutosave(projectStore, editor.project, { migrated })
  const testServer = useTestServer(projectStore, editor.project.id)

  // Renaming the Project renames the window with it: it is the same name.
  useWindowTitle(editor.project.name)

  // The Session is held here rather than in the panel that starts it, because
  // watching the bot think happens on the Canvas: both sides read one run.
  const session = useSession(editor.project, shell, testServer.testServerId)
  const exporting = useExport(editor.project, desktopExports)
  const sharing = useShare(editor.project, desktopShare)

  return (
    // The Console is a row of its own rather than something floating over the
    // Canvas: what it takes is only what it is showing, and collapsing it hands
    // every pixel of it back.
    <div className="grid h-full grid-rows-[auto_1fr_auto] overflow-hidden">
      <MenuBar
        onDashboard={() => void navigate({ to: "/" })}
        onOptions={() => setOptionsOpen(true)}
        saved={autosave.saved}
        problem={autosave.problem}
        exporting={exporting}
        sharing={sharing}
        run={<RunControls session={session} />}
      />

      <ProjectOptionsDialog
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        store={projectStore}
        projectId={editor.project.id}
        testServer={testServer}
      />

      <div className="grid grid-cols-[14rem_1fr] overflow-hidden">
        <aside className="overflow-y-auto border-r">
          <FlowList editor={editor} />
        </aside>

        <main className="h-full">
          <Canvas editor={editor} trace={session.trace} />
        </main>
      </div>

      <Console entries={session.entries} problem={session.problem} />
    </div>
  )
}
