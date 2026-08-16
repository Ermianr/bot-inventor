import type { OpenProjectOptions, OpenProjectResult, Project } from "@bot-inventor/schema"
import { openProject } from "@bot-inventor/schema"

/**
 * Everything the application does with a Project outside the Canvas.
 *
 * The application owns where Projects live (ADR 0009): the user never picks a
 * path, so there is nothing here that takes one. A Project is named by its id,
 * and what that id means on disk is the shell's business and nobody else's.
 *
 * It is one port rather than several because the things it covers are one
 * decision seen from different sides — a Project, the token that lets it run,
 * and the server it is tested on all begin and end together. Keeping them
 * behind one seam is what lets a single in-memory fake drive the Dashboard, the
 * editor and its autosave without a desktop shell, and what keeps the editor
 * working in a plain browser.
 *
 * The token operations belong here even though the keychain is not a folder:
 * what makes them part of this port is that they are keyed by Project and die
 * with it. Nothing here ever hands a token back — `hasSecret` is the whole of
 * what the editor is allowed to know about one.
 */

/** A Project as the store holds it: the document as text, and when it changed. */
export type StoredProject = {
  id: string
  document: string
  /** Milliseconds since the epoch, as `Date.now()` counts them. */
  changedAt: number
}

/**
 * What a Project needs to be usable and cannot be written into it: the token
 * goes to the keychain, the Test Server to the Project's own folder.
 */
export type ProjectCredentials = {
  secret: string
  testServerId: string
}

export type ProjectStore = {
  /** Every Project the application holds, in no particular order. */
  list(): Promise<readonly StoredProject[]>
  /**
   * Puts a Project in storage with its token and its Test Server.
   *
   * The three arrive together because a Project without a token is one whose
   * Run button is dead, and the moment between writing one and writing the next
   * is the moment a failure would leave exactly that. What the store cannot do
   * atomically it can at least be asked for atomically.
   */
  create(project: Project, credentials: ProjectCredentials): Promise<void>
  /** A Project's document as text, for this build to make sense of. */
  read(projectId: string): Promise<string>
  /** Writes a Project over the one in storage. This is what autosave calls. */
  write(project: Project): Promise<void>
  /** Copies the document beside itself, before a migration rewrites it. */
  backUp(projectId: string): Promise<void>
  /** The Test Server chosen for this Project, or `""` when none has been. */
  readTestServer(projectId: string): Promise<string>
  writeTestServer(projectId: string, testServerId: string): Promise<void>
  /** Whether the Project has a token, which is all anybody is told about one. */
  hasSecret(projectId: string): Promise<boolean>
  storeSecret(projectId: string, secret: string): Promise<void>
}

/** A Project as the Dashboard shows it, without reading the Flows inside it. */
export type ProjectSummary = {
  id: string
  name: string
  changedAt: number
}

/** The document written to storage: indented, because a user may well open it. */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, undefined, 2)}\n`
}

/**
 * What the Dashboard shows, newest change first.
 *
 * A document is read for its name and nothing else, and read leniently: a
 * Project written by a newer build, or one damaged halfway through a write, is
 * still the user's and still has to appear. It is refused with an explanation
 * when they open it — which is where an explanation is any use — rather than
 * quietly missing from the list, which would read as work that is gone.
 */
export async function listProjects(store: ProjectStore): Promise<readonly ProjectSummary[]> {
  const stored = await store.list()

  return stored
    .map(project => ({
      id: project.id,
      name: nameIn(project.document),
      changedAt: project.changedAt
    }))
    .sort((one, other) => other.changedAt - one.changedAt)
}

/**
 * Reads a Project out of storage: migrating it if it is behind, backing it up
 * first when it is, and refusing what this build cannot read.
 *
 * `options` exists so tests can exercise the chain with a fake migration; the
 * application passes nothing and gets the real one.
 */
export async function readStoredProject(
  store: ProjectStore,
  projectId: string,
  options: Omit<OpenProjectOptions, "writeBackup"> = {}
): Promise<OpenProjectResult> {
  const contents = await store.read(projectId)

  let document: unknown
  try {
    document = JSON.parse(contents)
  } catch (error) {
    return {
      status: "malformed",
      message: `This is not a Project: it is not readable as JSON. ${error instanceof Error ? error.message : String(error)}`,
      issues: []
    }
  }

  return openProject(document, {
    ...options,
    writeBackup: async () => {
      await store.backUp(projectId)
    }
  })
}

/** The name inside a document, or nothing when it does not read as a Project. */
function nameIn(document: string): string {
  try {
    const parsed: unknown = JSON.parse(document)
    if (typeof parsed === "object" && parsed !== null && "name" in parsed) {
      const { name } = parsed as { name: unknown }
      if (typeof name === "string" && name.trim().length > 0) return name
    }
  } catch {
    // Falls through to the placeholder: a document nobody can read still
    // belongs to somebody, and a card is how they get to the reason why.
  }
  return ""
}
