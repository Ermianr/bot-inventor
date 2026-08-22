import { describe, expect, it } from "bun:test"

import { emptyProject } from "./fixtures.js"
import {
  type Migration,
  MigrationChainError,
  migrations,
  readSchemaVersion,
  runMigrationChain
} from "./migrations.js"
import { CURRENT_SCHEMA_VERSION } from "./project.js"

/** A fake chain that exists only to prove the mechanism runs steps in order. */
const fakeChain: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    migrate: document => ({
      ...(document as Record<string, unknown>),
      schemaVersion: 2,
      steps: ["1->2"]
    })
  },
  {
    from: 2,
    to: 3,
    migrate: document => {
      const current = document as Record<string, unknown> & { steps: string[] }
      return { ...current, schemaVersion: 3, steps: [...current.steps, "2->3"] }
    }
  }
]

describe("readSchemaVersion", () => {
  it("reads the version of a Project", () => {
    expect(readSchemaVersion(emptyProject())).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("returns undefined when there is no readable version", () => {
    expect(readSchemaVersion({ schemaVersion: "one" })).toBeUndefined()
    expect(readSchemaVersion({ schemaVersion: 0 })).toBeUndefined()
    expect(readSchemaVersion(null)).toBeUndefined()
    expect(readSchemaVersion("not a document")).toBeUndefined()
  })
})

describe("runMigrationChain", () => {
  it("holds one step per format change, in order and without a gap", () => {
    expect(migrations.map(migration => [migration.from, migration.to])).toEqual([[1, 2]])
    expect(migrations.at(-1)?.to).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("is a no-op for a Project already at the current version", () => {
    const project = emptyProject()

    expect(runMigrationChain(project, CURRENT_SCHEMA_VERSION)).toBe(project)
  })

  it("runs every step in order, with each step seeing the previous one's output", () => {
    const result = runMigrationChain({ schemaVersion: 1 }, 1, {
      chain: fakeChain,
      targetVersion: 3
    })

    expect(result).toEqual({ schemaVersion: 3, steps: ["1->2", "2->3"] })
  })

  it("starts from the document's own version, skipping earlier steps", () => {
    const result = runMigrationChain({ schemaVersion: 2, steps: [] }, 2, {
      chain: fakeChain,
      targetVersion: 3
    })

    expect(result).toEqual({ schemaVersion: 3, steps: ["2->3"] })
  })

  it("refuses to run when a step of the chain is missing", () => {
    expect(() =>
      runMigrationChain({ schemaVersion: 1 }, 1, {
        chain: [fakeChain[0] as Migration],
        targetVersion: 3
      })
    ).toThrow(MigrationChainError)
  })

  it("refuses a step that does not move the version forward", () => {
    const backwards: Migration[] = [{ from: 1, to: 1, migrate: document => document }]

    expect(() =>
      runMigrationChain({ schemaVersion: 1 }, 1, { chain: backwards, targetVersion: 2 })
    ).toThrow(/does not move forward/)
  })

  it("refuses a chain that overshoots the target version", () => {
    expect(() =>
      runMigrationChain({ schemaVersion: 1 }, 1, { chain: fakeChain, targetVersion: 2 })
    ).not.toThrow()

    expect(() =>
      runMigrationChain({ schemaVersion: 1 }, 1, {
        chain: [{ from: 1, to: 3, migrate: document => document }],
        targetVersion: 2
      })
    ).toThrow(/overshot/)
  })
})
