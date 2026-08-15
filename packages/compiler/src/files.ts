import { stat } from "node:fs/promises"

/**
 * The small things the Compiler needs of a disk, in one place so that the three
 * callers that ask the same question ask it the same way.
 */

/** Whether there is anything at `path` — a file or a directory, either counts. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
