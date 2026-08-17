import { createFileRoute, useNavigate } from "@tanstack/react-router"

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

  return (
    <Dashboard
      store={projectStore}
      imports={desktopImport}
      onOpen={projectId => void navigate({ to: "/projects/$projectId", params: { projectId } })}
    />
  )
}
