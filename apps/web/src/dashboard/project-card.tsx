import { Button } from "@bot-inventor/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@bot-inventor/ui/components/dropdown-menu"
import { CopyIcon, EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { currentLocale, translate } from "@/i18n/messages"
import type { ProjectSummary } from "@/project/project-store"

/**
 * One Project, as the Dashboard shows it.
 *
 * The whole card is the way in: opening a Project is one action, and the thing
 * the user is pointing at is the thing they mean. Everything else a user does
 * to a Project — renaming it, copying it, deleting it — hangs off one menu in
 * the corner, so that the card keeps saying "open me" and the three rarer
 * things stay one gesture away rather than crowding it.
 *
 * That menu is why the card is a button inside a box rather than a button
 * holding everything: a control inside a button is not a control anybody can
 * reach with a keyboard, and the markup is not one a browser will honour.
 *
 * There is no preview of the Flow inside. Drawing one would mean rendering a
 * Canvas outside the editor from the first day, for something the user does not
 * choose by. What they do choose by is the colour, which is why it is here.
 */
export function ProjectCard({
  project,
  problem,
  onOpen,
  onRename,
  onDuplicate,
  onDelete
}: {
  project: ProjectSummary
  /** Why the last thing asked of this Project did not happen, when it did not. */
  problem: string | undefined
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative grid overflow-hidden rounded-md border bg-card transition-colors hover:border-foreground/30">
      <button
        type="button"
        data-testid={`project-card-${project.id}`}
        onClick={onOpen}
        className="grid w-full gap-3 text-left"
      >
        {/*
        A band of colour rather than a picture. It is the same colour every time
        for a given Project and different for the one beside it, so the card is
        recognised by its shape before a single word of it is read.
      */}
        <span
          aria-hidden
          className="h-16 w-full"
          style={{ backgroundColor: `oklch(0.65 0.16 ${hueOf(project.id)})` }}
        />

        <span className="grid gap-1 px-4 pb-4">
          <span className="truncate font-medium" data-testid="card-name">
            {project.name.length > 0 ? project.name : translate("dashboard.card.unreadable")}
          </span>
          <span className="text-muted-foreground text-xs">
            {translate("dashboard.card.changed", { when: whenChanged(project.changedAt) })}
          </span>
        </span>
      </button>

      {/*
        Over the band of colour rather than beside the name, so that it never
        moves as a name grows. It is drawn only under the pointer or the
        keyboard, because three cards' worth of menu buttons is what a
        Dashboard looks like when it has forgotten what it is for — but it is
        always in the tab order, since a control nobody can reach is not one.
      */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon-xs" variant="secondary" />}
          aria-label={translate("dashboard.card.manage")}
          data-testid={`card-manage-${project.id}`}
          className="absolute top-2 right-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem data-testid={`card-rename-${project.id}`} onClick={onRename}>
            <PencilIcon />
            {translate("dashboard.card.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`card-duplicate-${project.id}`} onClick={onDuplicate}>
            <CopyIcon />
            {translate("dashboard.card.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            data-testid={`card-delete-${project.id}`}
            onClick={onDelete}
          >
            <Trash2Icon />
            {translate("dashboard.card.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        A copy that could not be made is explained on the card the user asked
        it of. Renaming and deleting are asked for in a dialog and answered
        there; duplicating has no dialog, so this is the only place it could be
        said.
      */}
      {problem === undefined ? null : (
        <p
          className="px-4 pb-4 text-destructive text-sm"
          data-testid={`card-problem-${project.id}`}
        >
          {problem}
        </p>
      )}
    </div>
  )
}

/**
 * A hue for a Project, derived from its id so that it never moves. The id is a
 * UUID, so the sum of its characters is as good a spread over the wheel as
 * anything more elaborate would be.
 */
function hueOf(projectId: string): number {
  let total = 0
  for (const character of projectId) total = (total + character.charCodeAt(0)) % 360
  return total
}

/**
 * When the Project last changed, in the user's own language and their own time
 * zone. A date rather than "3 days ago": what the user is doing is finding the
 * one they were working on yesterday, and a date is what they compare.
 */
function whenChanged(changedAt: number): string {
  return dateFormatter(currentLocale()).format(new Date(changedAt))
}

/** One formatter per language, built the first time a card asks for it. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(locale: string): Intl.DateTimeFormat {
  const known = FORMATTERS.get(locale)
  if (known !== undefined) return known

  const built = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
  FORMATTERS.set(locale, built)
  return built
}
