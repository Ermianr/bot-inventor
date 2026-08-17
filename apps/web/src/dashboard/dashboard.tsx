import type { Project } from "@bot-inventor/schema"
import { Button } from "@bot-inventor/ui/components/button"
import { useState } from "react"

import { CreateProjectDialog } from "@/dashboard/create-project-dialog"
import { DeleteProjectDialog } from "@/dashboard/delete-project-dialog"
import { ProjectCard } from "@/dashboard/project-card"
import { RenameProjectDialog } from "@/dashboard/rename-project-dialog"
import { translate } from "@/i18n/messages"
import type { ImportGateway } from "@/project/import-gateway"
import type { ProjectStore, ProjectSummary } from "@/project/project-store"
import { useImport } from "@/project/use-import"
import { useProjects } from "@/project/use-projects"

/**
 * What the creation dialog is being opened about.
 *
 * The kind is what decides it, and an import is the one that brings something
 * with it — which is why this is a union rather than a kind and an optional
 * Project beside it: there is no such thing as an import without a Project, and
 * nothing else has one.
 */
type CreatingKind = { kind: "blank" | "example" } | { kind: "import"; incoming: Project }

/** That, plus whether the dialog is up and which opening this is. */
type Creating = CreatingKind & { open: boolean; asked: number }

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
  imports,
  onOpen
}: {
  store: ProjectStore
  /** Where a Project somebody sent is read from. */
  imports: ImportGateway
  /** Where a card takes the user. The route knows; the Dashboard does not. */
  onOpen: (projectId: string) => void
}) {
  const {
    projects,
    problem,
    creationProblem,
    forgetCreationProblem,
    manageProblem,
    create,
    createExample,
    importProject,
    rename,
    duplicate,
    remove
  } = useProjects(store)
  const {
    problem: importProblem,
    busy: reading,
    choose: chooseImport,
    forgetProblem: forgetImportProblem
  } = useImport(imports)
  /**
   * Which Project the creation dialog is about to make. One dialog serves all
   * three: the example and a Project somebody sent are Projects like any other,
   * so they are asked for with the same three questions.
   *
   * What is being made outlives the closing, which is what `open` is for. A
   * dialog that stopped existing the moment it was dismissed would never be
   * seen leaving, and would drop the keyboard on the floor rather than handing
   * it back to the button it was opened from.
   *
   * `asked` counts the openings. It is what the dialog is keyed by, so every
   * opening is a dialog that has never been filled in: what the user typed last
   * time is a bot token, and the one thing that must never be prefilled is the
   * token of another bot.
   */
  const [creating, setCreating] = useState<Creating>({ kind: "blank", open: false, asked: 0 })

  /** Opens the creation dialog on one of them, with nothing said yet. */
  const askFor = (about: CreatingKind) => {
    forgetCreationProblem()
    setCreating(was => ({ ...about, open: true, asked: was.asked + 1 }))
  }

  /**
   * Reads a Project File and asks the same three questions creating asks.
   *
   * Nothing exists yet when the dialog opens: what makes an import a Project is
   * the dialog being confirmed, so cancelling it leaves the Dashboard exactly
   * as it was and the file exactly where it is.
   */
  const startImport = () => {
    void (async () => {
      forgetImportProblem()
      const incoming = await chooseImport()
      // The user closed the dialog, or the file was not one this build reads —
      // and in that case the reason is already on the screen.
      if (incoming === undefined) return
      askFor({ kind: "import", incoming })
    })()
  }
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

          <div className="flex gap-2">
            {/*
              Importing sits beside making a bot rather than inside a menu on a
              card: it is how a Project that is not on this Dashboard yet gets
              onto it, so there is no card for it to hang from.
            */}
            <Button
              variant="outline"
              data-testid="dashboard-import"
              disabled={reading}
              onClick={startImport}
            >
              {translate("dashboard.import")}
            </Button>
            <Button data-testid="dashboard-create" onClick={() => askFor({ kind: "blank" })}>
              {translate("dashboard.create")}
            </Button>
          </div>
        </header>

        {problem === undefined ? null : (
          <p className="text-destructive text-sm" data-testid="dashboard-problem">
            {problem}
          </p>
        )}

        {/*
          A file that could not be read belongs to the screen rather than to a
          dialog: the dialog it would have opened is the one that never opened.
        */}
        {importProblem === undefined ? null : (
          <p className="text-destructive text-sm" data-testid="dashboard-import-problem">
            {importProblem}
          </p>
        )}

        {/*
          Nothing is drawn until the store has answered. An empty state shown
          while the list is still being read tells a user with ten Projects that
          they have none, which is the one thing this screen must never say.
        */}
        {projects === undefined ? null : projects.length === 0 ? (
          <Empty
            onCreate={() => askFor({ kind: "blank" })}
            onExample={() => askFor({ kind: "example" })}
            onImport={startImport}
            importing={reading}
          />
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
        Keyed by the opening rather than by what is being made, so that every
        one of them starts from what that kind begins with rather than from what
        the last one was left holding. Two imports are both of kind `import` and
        two blank Projects are both blank, and what the fields would carry over
        between them is the token of a bot that is already made. The key never
        changes while the dialog is open.
      */}
      <CreateProjectDialog
        key={creating.asked}
        open={creating.open}
        kind={creating.kind}
        suggestedName={creating.kind === "import" ? creating.incoming.name : undefined}
        onOpenChange={open => {
          if (open) return
          forgetCreationProblem()
          setCreating(was => ({ ...was, open: false }))
        }}
        problem={creationProblem}
        onCreate={details => {
          void (async () => {
            const created =
              creating.kind === "import"
                ? await importProject(creating.incoming, details)
                : creating.kind === "example"
                  ? await createExample(details)
                  : await create(details)
            if (created === undefined) return
            setCreating(was => ({ ...was, open: false }))
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
 * It offers more than one way in. Making a bot from nothing asks somebody who
 * has never seen a Node to invent one; the example is a real Project of their
 * own that they can take apart, which is how they find out what the pieces do.
 *
 * Importing is here as well because a first Dashboard is exactly where a bot
 * somebody sent arrives: being handed a `.botinv` is one of the two ways a user
 * with nothing built gets something to open.
 */
function Empty({
  onCreate,
  onExample,
  onImport,
  importing
}: {
  onCreate: () => void
  onExample: () => void
  onImport: () => void
  /** Whether a file is already being picked, which is when this cannot be. */
  importing: boolean
}) {
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
        <Button
          variant="outline"
          data-testid="dashboard-empty-import"
          disabled={importing}
          onClick={onImport}
        >
          {translate("dashboard.import")}
        </Button>
      </div>
    </div>
  )
}
