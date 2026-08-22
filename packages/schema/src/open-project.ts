import {
  type Migration,
  MigrationChainError,
  readSchemaVersion,
  runMigrationChain
} from "./migrations.js"
import { CURRENT_SCHEMA_VERSION, type Project, projectSchemaForVersion } from "./project.js"
import type { ValidationIssue } from "./validator.js"

export type OpenProjectOptions = {
  /**
   * Writes a backup of the document as it is on disk. It is called before any
   * migration touches the Project, and only then.
   */
  writeBackup: (document: unknown) => Promise<void> | void
  /** Overridable so tests can exercise the chain with a fake migration. */
  chain?: readonly Migration[]
  targetVersion?: number
}

/**
 * The outcome of opening a document. `status` and the data beside it are what
 * the editor renders its own translated copy from; `message` is the English
 * diagnostic, for logs and for reporting a problem.
 */
export type OpenProjectResult =
  | { status: "opened"; project: Project; migrated: boolean }
  | { status: "malformed"; message: string; issues: ValidationIssue[] }
  | {
      status: "future-version"
      message: string
      documentVersion: number
      supportedVersion: number
    }
  | { status: "migration-failed"; message: string }

/**
 * Reads a Project document: refuses what it cannot understand, migrates what is
 * behind, and validates the result.
 */
export async function openProject(
  document: unknown,
  options: OpenProjectOptions
): Promise<OpenProjectResult> {
  const targetVersion = options.targetVersion ?? CURRENT_SCHEMA_VERSION
  const documentVersion = readSchemaVersion(document)

  if (documentVersion === undefined) {
    return {
      status: "malformed",
      message:
        "This file is not a Project: it has no readable schemaVersion. It may be corrupted or written by another program.",
      issues: []
    }
  }

  if (documentVersion > targetVersion) {
    return {
      status: "future-version",
      message: `This Project was saved by a newer version of the app: it is written in Project format ${documentVersion}, and this build reads up to ${targetVersion}.`,
      documentVersion,
      supportedVersion: targetVersion
    }
  }

  let candidate = document
  const migrated = documentVersion < targetVersion

  if (migrated) {
    try {
      await options.writeBackup(document)
    } catch (error) {
      return {
        status: "migration-failed",
        message: `${notUpdated(targetVersion)}: its backup could not be written, so nothing was changed. ${describe(error)}`
      }
    }

    try {
      candidate = runMigrationChain(document, documentVersion, {
        chain: options.chain,
        targetVersion
      })
    } catch (error) {
      return {
        status: "migration-failed",
        message:
          error instanceof MigrationChainError
            ? error.message
            : `${notUpdated(targetVersion)}: ${describe(error)}`
      }
    }
  }

  const parsed = projectSchemaForVersion(targetVersion).safeParse(candidate)
  if (!parsed.success) {
    return {
      status: "malformed",
      message: migrated
        ? `${notUpdated(targetVersion)}: the result does not match Project format ${targetVersion}.`
        : `This document does not match Project format ${targetVersion}.`,
      issues: parsed.error.issues
    }
  }

  return { status: "opened", project: parsed.data, migrated }
}

/** Renders the issues of a malformed Project as one line per problem. */
export function formatProjectIssues(issues: readonly ValidationIssue[]): string[] {
  return issues.map(issue => {
    const path = issue.path.join(".")
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message
  })
}

function notUpdated(targetVersion: number): string {
  return `This Project could not be brought up to format ${targetVersion}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
