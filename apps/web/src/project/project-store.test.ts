import { describe, expect, it } from "bun:test"

import type { Migration } from "@bot-inventor/schema"
import { CURRENT_SCHEMA_VERSION } from "@bot-inventor/schema"
import { helloProject } from "@bot-inventor/schema/fixtures"

import { fakeProjectStore } from "@/project/fake-project-store"
import { listProjects, readStoredProject, serializeProject } from "@/project/project-store"

/**
 * The decisions made on top of the port: what a document is read as, and what
 * happens on the way in when it is behind.
 */

/**
 * A Project one format behind, and the step that catches it up.
 *
 * No format change has happened yet, so "behind" is made by pretending this
 * build reads one version further than it does. It is the mechanism that is
 * under test, not any particular migration.
 */
const NEXT_VERSION = CURRENT_SCHEMA_VERSION + 1

function behind() {
  const document = { ...helloProject(), schemaVersion: CURRENT_SCHEMA_VERSION }
  const chain: readonly Migration[] = [
    {
      from: CURRENT_SCHEMA_VERSION,
      to: NEXT_VERSION,
      migrate: project => ({ ...(project as object), schemaVersion: NEXT_VERSION })
    }
  ]
  return { document, chain, targetVersion: NEXT_VERSION }
}

describe("reading a Project out of storage", () => {
  it("hands back the Project the store holds", async () => {
    const store = fakeProjectStore([helloProject()])

    const result = await readStoredProject(store, helloProject().id)

    expect(result).toEqual({ status: "opened", project: helloProject(), migrated: false })
  })

  /**
   * Every Project format change ships with a migration and a backup step. The
   * backup is the version the user had, and it is taken before anything is
   * changed rather than after — the point of it is the case where the change
   * goes wrong.
   */
  it("backs a Project up before bringing it up to date", async () => {
    const { document, chain, targetVersion } = behind()
    const store = fakeProjectStore()
    store.contents.set(helloProject().id, {
      document: JSON.stringify(document),
      testServerId: "",
      secret: ""
    })

    const result = await readStoredProject(store, helloProject().id, { chain, targetVersion })

    expect(result).toMatchObject({ status: "opened", migrated: true })
    expect(store.backups).toEqual([JSON.stringify(document)])
  })

  it("changes nothing and takes no backup for a Project that is already current", async () => {
    const store = fakeProjectStore([helloProject()])

    await readStoredProject(store, helloProject().id)

    expect(store.backups).toEqual([])
    expect(store.contents.get(helloProject().id)?.document).toBe(serializeProject(helloProject()))
  })

  it("refuses a document that is not JSON, and says why", async () => {
    const store = fakeProjectStore()
    store.contents.set("project-damaged", { document: "half a fi", testServerId: "", secret: "" })

    const result = await readStoredProject(store, "project-damaged")

    expect(result.status).toBe("malformed")
  })
})

describe("what the Dashboard is shown", () => {
  it("reads each Project's name out of its own document", async () => {
    const store = fakeProjectStore([helloProject()])

    const listed = await listProjects(store)

    expect(listed).toEqual([
      { id: helloProject().id, name: helloProject().name, changedAt: expect.any(Number) }
    ])
  })

  /**
   * A name the Dashboard cannot find is left empty rather than invented, so the
   * card is what says the Project could not be read — in the user's own
   * language, which this layer does not speak.
   */
  it("leaves the name empty for a document it cannot read", async () => {
    const store = fakeProjectStore()
    store.contents.set("project-damaged", { document: "half a fi", testServerId: "", secret: "" })

    const listed = await listProjects(store)

    expect(listed[0]).toMatchObject({ id: "project-damaged", name: "" })
  })
})
