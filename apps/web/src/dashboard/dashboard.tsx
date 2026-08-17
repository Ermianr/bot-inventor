import { Button } from "@bot-inventor/ui/components/button"
import { useState } from "react"

import { CreateProjectDialog } from "@/dashboard/create-project-dialog"
import { DeleteProjectDialog } from "@/dashboard/delete-project-dialog"
import { ProjectCard } from "@/dashboard/project-card"
import { RenameProjectDialog } from "@/dashboard/rename-project-dialog"
import { translate } from "@/i18n/messages"
import type { ProjectStore, ProjectSummary } from "@/project/project-store"
import { useProjects } from "@/project/use-projects"

/**
 * The Dashboard: the first thing the user sees, every time.
 *
 * It exists so that opening the application is being shown what you have built
 * rather than being handed a Canvas holding a Project nobody asked for. Cards
 * in a grid, and that is all — no folders, no search, no sorting. Somebody with
 * three bots needs none of them, and somebody with thirty has a different
 * application in mind than this one.
 */
export function Dashboard({
  store,
  onOpen
}: {
  store: ProjectStore
  /** Where a card takes the user. The route knows; the Dashboard does not. */
  onOpen: (projectId: string) => void
}) {
  const {
    projects,
    problem,
    creationProblem,
    manageProblem,
    create,
    createExample,
    rename,
    duplicate,
    remove
  } = useProjects(store)
  /**
   * Which Project the creation dialog is about to make, or nothing when it is
   * closed. One dialog serves both: the example is a Project like any other, so
   * it is asked for with the same three questions.
   */
  const [creating, setCreating] = useState<"blank" | "example" | undefined>(undefined)
  /**
   * The Project a dialog is about, held as an id rather than as a summary: the
   * list is read again after every one of these, and a dialog left holding the
   * old copy of a Project would show the name it had before it was renamed.
   */
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState<string | undefined>(undefined)

  const find = (projectId: string | undefined): ProjectSummary | undefined =>
    projectId === undefined ? undefined : projects?.find(project => project.id === projectId)

  /** The reason for this Project, when it is this Project the reason is about. */
  const problemOf = (projectId: string) =>
    manageProblem?.projectId === projectId ? manageProblem.message : undefined

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-8 px-8 py-12">
        <header className="flex items-end justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="font-semibold text-2xl">{translate("dashboard.title")}</h1>
            <p className="text-muted-foreground text-sm">{translate("dashboard.subtitle")}</p>
          </div>

          <Button data-testid="dashboard-create" onClick={() => setCreating("blank")}>
            {translate("dashboard.create")}
          </Button>
        </header>

        {problem === undefined ? null : (
          <p className="text-destructive text-sm" data-testid="dashboard-problem">
            {problem}
          </p>
        )}

        {/*
          Nothing is drawn until the store has answered. An empty state shown
          while the list is still being read tells a user with ten Projects that
          they have none, which is the one thing this screen must never say.
        */}
        {projects === undefined ? null : projects.length === 0 ? (
          <Empty onCreate={() => setCreating("blank")} onExample={() => setCreating("example")} />
        ) : (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4"
            data-testid="dashboard-projects"
          >
            {projects.map(project => (
              <li key={project.id}>
                <ProjectCard
                  project={project}
                  // A rename and a delete are answered in their own dialogs,
                  // so the only failure the card itself has to say out loud is
                  // the one with nowhere else to go.
                  problem={
                    renaming === project.id || deleting === project.id
                      ? undefined
                      : problemOf(project.id)
                  }
                  onOpen={() => onOpen(project.id)}
                  onRename={() => setRenaming(project.id)}
                  onDuplicate={() => void duplicate(project.id)}
                  onDelete={() => setDeleting(project.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Keyed by which of the two was asked for, so that the fields start again
        from what that one begins with rather than from what the last one was
        left holding.
      */}
      <CreateProjectDialog
        key={creating ?? "closed"}
        open={creating !== undefined}
        kind={creating === "example" ? "example" : "blank"}
        onOpenChange={open => open || setCreating(undefined)}
        problem={creationProblem}
        onCreate={details => {
          void (async () => {
            const created =
              creating === "example" ? await createExample(details) : await create(details)
            if (created === undefined) return
            setCreating(undefined)
            onOpen(created)
          })()
        }}
      />

      <RenameProjectDialog
        project={find(renaming)}
        problem={renaming === undefined ? undefined : problemOf(renaming)}
        onOpenChange={open => open || setRenaming(undefined)}
        onRename={name => {
          void (async () => {
            if (renaming === undefined) return
            if (await rename(renaming, name)) setRenaming(undefined)
          })()
        }}
      />

      <DeleteProjectDialog
        project={find(deleting)}
        problem={deleting === undefined ? undefined : problemOf(deleting)}
        onOpenChange={open => open || setDeleting(undefined)}
        onDelete={() => {
          void (async () => {
            if (deleting === undefined) return
            if (await remove(deleting)) setDeleting(undefined)
          })()
        }}
      />
    </div>
  )
}

/**
 * A Dashboard with nothing on it, which is what every user sees first.
 *
 * It offers two ways in rather than one. Making a bot from nothing asks
 * somebody who has never seen a Node to invent one; the example is a real
 * Project of their own that they can take apart, which is how they find out
 * what the pieces do.
 */
function Empty({ onCreate, onExample }: { onCreate: () => void; onExample: () => void }) {
  return (
    <div
      className="grid justify-items-center gap-4 py-24 text-center"
      data-testid="dashboard-empty"
    >
      <p className="font-medium text-lg">{translate("dashboard.empty.title")}</p>
      <p className="max-w-md text-muted-foreground text-sm">{translate("dashboard.empty.body")}</p>
      <div className="flex gap-2">
        <Button data-testid="dashboard-empty-create" onClick={onCreate}>
          {translate("dashboard.create")}
        </Button>
        <Button variant="outline" data-testid="dashboard-example" onClick={onExample}>
          {translate("dashboard.example")}
        </Button>
      </div>
    </div>
  )
}
