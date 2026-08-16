import { type ProjectStore, type StoredProject, serializeProject } from "@/project/project-store"

/**
 * The same port, backed by the browser's own storage.
 *
 * The editor runs in a plain browser — during development, and under the
 * end-to-end tests — where there is no folder to own and no keychain to write
 * to. This is what makes those runs real: the Dashboard lists, autosave writes,
 * and a reload finds the work where it was left, without a desktop shell.
 *
 * It is deliberately not a Secret store. A token put here is held as plainly as
 * anything else in a browser, which is exactly why the desktop shell keeps the
 * real one in the operating system's keychain instead. Nothing outside a
 * development machine ever reaches this file.
 */

/** What every key this writes begins with, so nothing else in storage is ours. */
const PREFIX = "bot-inventor.project."

/** Backups live under their own prefix so that listing never finds one and
 * shows it as a Project of its own. */
const BACKUP_PREFIX = "bot-inventor.backup."

/** One Project, as the browser holds it. */
type Entry = {
  document: string
  changedAt: number
  testServerId: string
  /** Whether a token was given, which is all the editor is ever told. */
  hasSecret: boolean
}

function read(projectId: string): Entry | undefined {
  const stored = localStorage.getItem(`${PREFIX}${projectId}`)
  if (stored === null) return undefined
  try {
    return JSON.parse(stored) as Entry
  } catch {
    return undefined
  }
}

function save(projectId: string, entry: Entry): void {
  localStorage.setItem(`${PREFIX}${projectId}`, JSON.stringify(entry))
}

/** The entry a Project must have for anything but creation to make sense. */
function entryOf(projectId: string): Entry {
  const entry = read(projectId)
  if (entry === undefined) throw new Error(`there is no Project called ${projectId}`)
  return entry
}

export const browserProjectStore: ProjectStore = {
  list: async () => {
    const projects: StoredProject[] = []

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key === null || !key.startsWith(PREFIX)) continue

      const id = key.slice(PREFIX.length)
      const entry = read(id)
      if (entry === undefined) continue

      projects.push({ id, document: entry.document, changedAt: entry.changedAt })
    }

    return projects
  },

  create: async (project, credentials) => {
    if (read(project.id) !== undefined) {
      throw new Error(`there is already a Project called ${project.id}`)
    }
    save(project.id, {
      document: serializeProject(project),
      changedAt: Date.now(),
      testServerId: credentials.testServerId,
      hasSecret: credentials.secret.length > 0
    })
  },

  read: async projectId => entryOf(projectId).document,

  write: async project => {
    save(project.id, {
      ...entryOf(project.id),
      document: serializeProject(project),
      changedAt: Date.now()
    })
  },

  backUp: async projectId => {
    const entry = entryOf(projectId)
    localStorage.setItem(`${BACKUP_PREFIX}${projectId}`, entry.document)
  },

  readTestServer: async projectId => entryOf(projectId).testServerId,

  writeTestServer: async (projectId, testServerId) => {
    save(projectId, { ...entryOf(projectId), testServerId })
  },

  hasSecret: async projectId => read(projectId)?.hasSecret ?? false,

  storeSecret: async (projectId, secret) => {
    save(projectId, { ...entryOf(projectId), hasSecret: secret.length > 0 })
  }
}
