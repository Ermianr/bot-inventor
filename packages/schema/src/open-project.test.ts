import { describe, expect, it, mock } from "bun:test"

import {
  danglingWireProject,
  emptyProject,
  futureVersionProject,
  greetingProject
} from "./fixtures.js"
import type { Migration } from "./migrations.js"
import { openProject } from "./open-project.js"
import { CURRENT_SCHEMA_VERSION } from "./project.js"

const writeBackup = () => mock(async () => {})

/**
 * A document written at the format before this build's. The migration tests
 * drive the mechanism with a chain of their own, so what matters about it is
 * only that it is behind: what the real chain does to a real Project is
 * `migrate-to-slotted-text.test.ts`.
 */
const olderProject = () => ({ ...emptyProject(), schemaVersion: 1 })

describe("openProject", () => {
  it("opens a current-version Project without migrating or backing it up", async () => {
    const backup = writeBackup()

    const result = await openProject(greetingProject(), { writeBackup: backup })

    expect(result).toMatchObject({ status: "opened", migrated: false })
    expect(backup).not.toHaveBeenCalled()
    if (result.status === "opened") {
      expect(result.project).toEqual(greetingProject())
    }
  })

  it("refuses a Project written by a newer version of the app", async () => {
    const backup = writeBackup()

    const result = await openProject(futureVersionProject(), { writeBackup: backup })

    expect(result.status).toBe("future-version")
    if (result.status === "future-version") {
      expect(result.documentVersion).toBe(CURRENT_SCHEMA_VERSION + 1)
      expect(result.supportedVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(result.message).toContain("newer version")
    }
    expect(backup).not.toHaveBeenCalled()
  })

  it("refuses a file that is not a Project", async () => {
    const result = await openProject({ hello: "world" }, { writeBackup: writeBackup() })

    expect(result.status).toBe("malformed")
    if (result.status === "malformed") {
      expect(result.message).toContain("schemaVersion")
    }
  })

  it("reports what is wrong with a malformed Project", async () => {
    const result = await openProject(danglingWireProject(), { writeBackup: writeBackup() })

    expect(result.status).toBe("malformed")
    if (result.status === "malformed") {
      expect(result.issues.map(issue => issue.message).join("\n")).toContain("node-missing")
    }
  })

  it("backs the Project up before a migration touches it, then migrates", async () => {
    const order: string[] = []
    const backup = mock(async () => {
      order.push("backup")
    })
    const chain: Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: document => {
          order.push("migrate")
          const project = document as ReturnType<typeof emptyProject>
          return { ...project, schemaVersion: 2, name: "Migrated Project" }
        }
      }
    ]

    const result = await openProject(olderProject(), {
      writeBackup: backup,
      chain,
      targetVersion: 2
    })

    expect(order).toEqual(["backup", "migrate"])
    expect(backup).toHaveBeenCalledWith(olderProject())
    expect(result).toMatchObject({ status: "opened", migrated: true })
    if (result.status === "opened") {
      expect(result.project.name).toBe("Migrated Project")
      expect(result.project.schemaVersion).toBe(2)
    }
  })

  it("leaves the Project alone when its backup cannot be written", async () => {
    const migrate = mock((document: unknown) => document)
    const chain: Migration[] = [{ from: 1, to: 2, migrate }]

    const result = await openProject(olderProject(), {
      writeBackup: () => {
        throw new Error("the disk is full")
      },
      chain,
      targetVersion: 2
    })

    expect(migrate).not.toHaveBeenCalled()
    expect(result.status).toBe("migration-failed")
    if (result.status === "migration-failed") {
      expect(result.message).toContain("the disk is full")
    }
  })

  it("reports a missing migration instead of guessing at the Project", async () => {
    const result = await openProject(olderProject(), {
      writeBackup: writeBackup(),
      chain: [],
      targetVersion: 2
    })

    expect(result.status).toBe("migration-failed")
    if (result.status === "migration-failed") {
      expect(result.message).toContain("no migration is registered")
    }
  })

  it("refuses a migration that forgets to raise the schemaVersion", async () => {
    const chain: Migration[] = [
      { from: 1, to: 2, migrate: document => ({ ...(document as object), name: "Still at 1" }) }
    ]

    const result = await openProject(olderProject(), {
      writeBackup: writeBackup(),
      chain,
      targetVersion: 2
    })

    expect(result.status).toBe("malformed")
    if (result.status === "malformed") {
      expect(result.issues.map(issue => issue.path.join(".")).join("\n")).toContain("schemaVersion")
    }
  })

  it("reports a migration whose result no longer matches the Project format", async () => {
    const chain: Migration[] = [
      { from: 1, to: 2, migrate: () => ({ schemaVersion: 2, flows: "all of them" }) }
    ]

    const result = await openProject(olderProject(), {
      writeBackup: writeBackup(),
      chain,
      targetVersion: 2
    })

    expect(result.status).toBe("malformed")
    if (result.status === "malformed") {
      expect(result.message).toContain("could not be brought up to format 2")
      expect(result.issues.length).toBeGreaterThan(0)
    }
  })

  it("reports a migration that throws", async () => {
    const chain: Migration[] = [
      {
        from: 1,
        to: 2,
        migrate: () => {
          throw new Error("the Flow could not be rewritten")
        }
      }
    ]

    const result = await openProject(olderProject(), {
      writeBackup: writeBackup(),
      chain,
      targetVersion: 2
    })

    expect(result.status).toBe("migration-failed")
    if (result.status === "migration-failed") {
      expect(result.message).toContain("the Flow could not be rewritten")
    }
  })
})
