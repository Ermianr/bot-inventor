import type { OpenProjectOptions, OpenProjectResult, Project } from "@bot-inventor/schema"
import { openProject } from "@bot-inventor/schema"

/**
 * A Project on disk: the `.botinv` file the user saves, sends to a friend, and
 * opens again.
 *
 * The file holds the Project and nothing else. A Secret is never written here —
 * it stays in the operating system keychain, keyed to the Project — so a
 * `.botinv` carries the bot's design and none of its credentials.
 */

/** The extension a Project is saved under. */
export const PROJECT_FILE_EXTENSION = "botinv"

/**
 * Everything reading and writing a Project needs from the machine it runs on.
 *
 * It is a port rather than direct Tauri calls so that the decisions here — what
 * counts as unreadable, when a backup is written — are testable without a
 * desktop shell, and so the editor keeps working in a plain browser.
 */
export type ProjectFileSystem = {
  read(path: string): Promise<string>
  write(path: string, contents: string): Promise<void>
  /** Copies the file as it is on disk, beside itself, and says where it went. */
  backUp(path: string): Promise<string>
}

/**
 * The file system plus the two questions only the user can answer: which file,
 * and whether unsaved work may be thrown away.
 *
 * They sit together because they are the same thing to the editor — the world
 * outside the Canvas — and because a test that drives Save wants to answer both
 * without a desktop shell.
 */
export type ProjectFileGateway = ProjectFileSystem & {
  /** Where to save, or `undefined` if the user closed the dialog. */
  chooseSavePath(suggestedName: string): Promise<string | undefined>
  /** What to open, or `undefined` if the user closed the dialog. */
  chooseOpenPath(): Promise<string | undefined>
  /** Whether the user accepts losing the changes they have not saved. */
  confirmDiscard(projectName: string): Promise<boolean>
}

/** The document written to disk: indented, because a user may well open it. */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, undefined, 2)}\n`
}

/** Writes a Project over whatever is at `path`. */
export async function writeProjectFile(
  path: string,
  project: Project,
  fileSystem: ProjectFileSystem
): Promise<void> {
  await fileSystem.write(path, serializeProject(project))
}

/**
 * Reads a Project from disk: migrating it if it is behind, backing it up first
 * when it is, and refusing what this build cannot read.
 *
 * `options` exists so tests can exercise the chain with a fake migration; the
 * application passes nothing and gets the real one.
 */
export async function readProjectFile(
  path: string,
  fileSystem: ProjectFileSystem,
  options: Omit<OpenProjectOptions, "writeBackup"> = {}
): Promise<OpenProjectResult> {
  const contents = await fileSystem.read(path)

  let document: unknown
  try {
    document = JSON.parse(contents)
  } catch (error) {
    return {
      status: "malformed",
      message: `This file is not a Project: it is not readable as JSON. ${describeError(error)}`,
      issues: []
    }
  }

  return openProject(document, {
    ...options,
    writeBackup: async () => {
      await fileSystem.backUp(path)
    }
  })
}

/** The file name offered in the save dialog, built from the Project's name. */
export function suggestedFileName(project: Project): string {
  const slug = project.name
    // Splitting an accented letter into letter plus mark, so that the mark is
    // one of the characters dropped below and the letter survives.
    .normalize("NFD")
    .toLowerCase()
    // Everything that is not a letter or a digit becomes a separator: an
    // accent, a space or an exclamation mark has no business in a file name.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${slug.length > 0 ? slug : "project"}.${PROJECT_FILE_EXTENSION}`
}

/** What went wrong, as a line that can be put in front of the user. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
