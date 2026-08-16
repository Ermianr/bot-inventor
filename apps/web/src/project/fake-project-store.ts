import type { Project } from "@bot-inventor/schema"

import { type ProjectStore, type StoredProject, serializeProject } from "@/project/project-store"

/**
 * The port, in memory.
 *
 * This is what makes the whole feature testable: the Dashboard, autosave and
 * the Run Panel are driven through it with no desktop shell, no keychain and
 * no folder anywhere. It lives beside the code rather than inside one test file
 * because every one of those tests wants the same one.
 *
 * It keeps a token rather than pretending to, so that a test can assert a
 * Project was stored with the credentials it was created with — which is the
 * one thing about Secrets the application is responsible for. The real store
 * never hands one back, and neither does `hasSecret` here.
 */
export type FakeProjectStore = ProjectStore & {
  /** What is in storage, so a test can look without going through the port. */
  contents: Map<string, { document: string; testServerId: string; secret: string }>
  /** Every backup taken, newest last. */
  backups: string[]
  /** Makes the next call of that name fail, the way a full disk would. */
  breaks: Partial<Record<keyof ProjectStore, string>>
}

export function fakeProjectStore(initial: readonly Project[] = []): FakeProjectStore {
  const contents = new Map<string, { document: string; testServerId: string; secret: string }>()
  const backups: string[] = []
  const breaks: Partial<Record<keyof ProjectStore, string>> = {}

  for (const project of initial) {
    contents.set(project.id, { document: serializeProject(project), testServerId: "", secret: "" })
  }

  /** Fails when this test asked that call to, and clears the ask. */
  function check(call: keyof ProjectStore): void {
    const message = breaks[call]
    if (message === undefined) return
    delete breaks[call]
    throw new Error(message)
  }

  function entry(projectId: string) {
    const found = contents.get(projectId)
    if (found === undefined) throw new Error(`there is no Project called ${projectId}`)
    return found
  }

  // Time moves one tick per write, so that the order the Dashboard shows is
  // decidable. A real clock makes two Projects written in the same millisecond
  // sort by nothing at all, which is a test that fails once a month.
  let clock = 0
  const changedAt = new Map<string, number>()
  /** Marks a Project as the most recently changed one. */
  function touch(projectId: string): void {
    clock += 1
    changedAt.set(projectId, clock)
  }
  for (const project of initial) touch(project.id)

  const store: FakeProjectStore = {
    contents,
    backups,
    breaks,

    list: async () => {
      check("list")
      const listed: StoredProject[] = []
      for (const [id, held] of contents) {
        listed.push({ id, document: held.document, changedAt: changedAt.get(id) ?? 0 })
      }
      return listed
    },

    create: async (project, credentials) => {
      check("create")
      if (contents.has(project.id)) {
        throw new Error(`there is already a Project called ${project.id}`)
      }
      contents.set(project.id, {
        document: serializeProject(project),
        testServerId: credentials.testServerId,
        secret: credentials.secret
      })
      touch(project.id)
    },

    read: async projectId => {
      check("read")
      return entry(projectId).document
    },

    write: async project => {
      check("write")
      contents.set(project.id, { ...entry(project.id), document: serializeProject(project) })
      touch(project.id)
    },

    backUp: async projectId => {
      check("backUp")
      backups.push(entry(projectId).document)
    },

    readTestServer: async projectId => {
      check("readTestServer")
      return entry(projectId).testServerId
    },

    writeTestServer: async (projectId, testServerId) => {
      check("writeTestServer")
      contents.set(projectId, { ...entry(projectId), testServerId })
    },

    hasSecret: async projectId => {
      check("hasSecret")
      return entry(projectId).secret.length > 0
    },

    storeSecret: async (projectId, secret) => {
      check("storeSecret")
      contents.set(projectId, { ...entry(projectId), secret })
    }
  }

  return store
}
