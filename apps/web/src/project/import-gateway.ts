import type { OpenProjectResult } from "@bot-inventor/schema"

import { openDocument } from "@/project/open-document"

/**
 * Importing, as the editor sees it: a Project File somewhere outside the
 * application's storage, and the reading of it.
 *
 * It is the mirror of `share-gateway.ts`, and separated for the same reason:
 * only the first half is a question for the user, and a test has to be able to
 * answer it without a dialog.
 *
 * Nothing here reaches storage. What comes back is a document, and what a
 * document means is the schema's business — which is what keeps the one place
 * that decides whether a file is a Project the same place for a Project File
 * and for a Project already in storage.
 */
export type ImportGateway = {
  /**
   * Asks the user which Project File to take in, or `undefined` when they
   * changed their mind.
   *
   * An open dialog rather than a save one, and a single file rather than
   * several: an import ends on the Canvas of the Project it made, and there is
   * only one Canvas to end on.
   */
  chooseSource(): Promise<string | undefined>
  /** Reads the document at that path. It throws when it cannot. */
  read(path: string): Promise<string>
}

/**
 * Reads a document somebody sent as a Project, migrating it when it was written
 * by an older build and refusing what this one cannot understand.
 *
 * No backup is written, unlike opening a Project out of storage. A migration
 * there rewrites the only copy there is; here the file the user picked is left
 * exactly as it was, so the copy a backup would make already exists, on their
 * disk, where they put it.
 */
export async function readProjectFile(contents: string): Promise<OpenProjectResult> {
  return openDocument(contents, { writeBackup: () => {} })
}
