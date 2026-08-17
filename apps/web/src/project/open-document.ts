import type { OpenProjectOptions, OpenProjectResult } from "@bot-inventor/schema"
import { openProject } from "@bot-inventor/schema"

/**
 * Making a Project out of text: the JSON, and then the schema's own reading of
 * what the JSON turned out to be.
 *
 * There is one of these because there is one answer to "is this a Project" and
 * it must not depend on where the text came from. A Project out of the
 * application's own storage and a Project File somebody sent are the same
 * document, so they are refused by the same code, in the same words, and a
 * format the schema learns to read is one both of them can read at once.
 *
 * What differs between the two is only what a migration owes: a Project in
 * storage is backed up before it is rewritten, and a Project File is not — the
 * file is left where the user put it, so the copy already exists. That is what
 * `options` carries, and it is the whole of the difference.
 */
export async function openDocument(
  contents: string,
  options: OpenProjectOptions
): Promise<OpenProjectResult> {
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

  return openProject(document, options)
}
