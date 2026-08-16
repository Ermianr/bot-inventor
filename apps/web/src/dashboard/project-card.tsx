import { currentLocale, translate } from "@/i18n/messages"
import type { ProjectSummary } from "@/project/project-store"

/**
 * One Project, as the Dashboard shows it.
 *
 * The whole card is the way in: opening a Project is one action, and the thing
 * the user is pointing at is the thing they mean.
 *
 * There is no preview of the Flow inside. Drawing one would mean rendering a
 * Canvas outside the editor from the first day, for something the user does not
 * choose by. What they do choose by is the colour, which is why it is here.
 */
export function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid={`project-card-${project.id}`}
      onClick={onOpen}
      className="grid w-full gap-3 overflow-hidden rounded-md border bg-card text-left transition-colors hover:border-foreground/30"
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
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(changedAt))
}
