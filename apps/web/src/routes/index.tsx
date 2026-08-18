import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { useWindowTitle } from "@/about/window-title"
import { Dashboard } from "@/dashboard/dashboard"
import { desktopImport } from "@/project/desktop-import"
import { projectStore } from "@/project/store"

export const Route = createFileRoute("/")({
  component: DashboardRoute
})

/**
 * The root screen. Opening a Project is a navigation rather than a state
 * change, which is what makes the back button take the user home again.
 */
function DashboardRoute() {
  const navigate = useNavigate()

  // No Project is open here, so the title bar is the application alone.
  useWindowTitle()

  return (
    <Dashboard
      store={projectStore}
      imports={desktopImport}
      onOpen={projectId => void navigate({ to: "/projects/$projectId", params: { projectId } })}
    />
  )
}
