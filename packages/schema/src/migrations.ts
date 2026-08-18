import { z } from "zod"
import { toSlottedText } from "./migrate-to-slotted-text.js"
import { CURRENT_SCHEMA_VERSION } from "./project.js"

/**
 * One step of the migration chain: it takes a Project document written at
 * version `from` and returns the same Project shaped for version `to`.
 *
 * Migrations work on unvalidated documents on purpose. The shape they receive
 * is the one an older build wrote, which no longer has a schema in this build.
 */
export type Migration = {
  from: number
  to: number
  migrate: (document: unknown) => unknown
}

/** The ordered migration chain, one step per format change. */
export const migrations: readonly Migration[] = [toSlottedText]

/** Reads the `schemaVersion` of a document without trusting the rest of it. */
export function readSchemaVersion(document: unknown): number | undefined {
  const parsed = z.object({ schemaVersion: z.int().positive() }).safeParse(document)
  return parsed.success ? parsed.data.schemaVersion : undefined
}

export class MigrationChainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MigrationChainError"
  }
}

/**
 * Runs every migration needed to bring `document` from its own version up to
 * `targetVersion`, in order. A document already at the target version is
 * returned untouched.
 */
export function runMigrationChain(
  document: unknown,
  fromVersion: number,
  options: {
    chain?: readonly Migration[]
    targetVersion?: number
  } = {}
): unknown {
  const chain = options.chain ?? migrations
  const targetVersion = options.targetVersion ?? CURRENT_SCHEMA_VERSION

  let version = fromVersion
  let current = document

  while (version < targetVersion) {
    const step = chain.find(migration => migration.from === version)
    if (!step) {
      throw new MigrationChainError(
        `no migration is registered from schemaVersion ${version} to ${targetVersion}`
      )
    }
    if (step.to <= step.from) {
      throw new MigrationChainError(
        `the migration from schemaVersion ${step.from} does not move forward (it targets ${step.to})`
      )
    }
    current = step.migrate(current)
    version = step.to
  }

  if (version !== targetVersion) {
    throw new MigrationChainError(
      `the migration chain overshot schemaVersion ${targetVersion} and stopped at ${version}`
    )
  }

  return current
}
