import type { Project } from "@bot-inventor/schema"
import { demonstrationProject } from "@/project/demonstration-project"
import { newProject } from "@/project/new-project"
import { inDesktopShell } from "@/session/desktop"

/**
 * The Project the editor opens with.
 *
 * In the desktop application that is a new, empty Project: the user starts on
 * their own Canvas, and reaches everything else through Open. In a plain
 * browser — during development, and under the end-to-end tests — there is no
 * file to open and no dialog to open it with, so the editor starts from the
 * demonstration Project instead of from an empty Canvas nothing can fill.
 */
export function initialProject(): Project {
  return inDesktopShell() ? newProject() : demonstrationProject()
}
