import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { Dashboard } from "@/dashboard/dashboard"
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
      onOpen={projectId => void navigate({ to: "/projects/$projectId", params: { projectId } })}
    />
  )
}
