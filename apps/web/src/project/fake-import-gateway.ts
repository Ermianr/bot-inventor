import type { ImportGateway } from "@/project/import-gateway"

/**
 * The port, without a dialog: a file the user is taken to have picked, and what
 * is in it.
 *
 * It lives beside the code rather than inside one test file because both halves
 * of an import want it — the hook that reads a Project File, and the Dashboard
 * that asks the Project's questions afterwards.
 */
export type FakeImportGateway = ImportGateway & {
  /** Every path the user was taken to have picked, oldest first. */
  chosen: string[]
}

export function fakeImportGateway(
  answers: {
    /** What the open dialog hands back, or nothing when the user closes it. */
    path?: string
    /** What is in the file at that path. */
    contents?: string
    /** What the read does instead of succeeding, when it does not. */
    refuse?: Error
  } = {}
): FakeImportGateway {
  const chosen: string[] = []

  return {
    chosen,
    chooseSource: async () => answers.path,
    read: async path => {
      chosen.push(path)
      if (answers.refuse !== undefined) throw answers.refuse
      return answers.contents ?? ""
    }
  }
}
