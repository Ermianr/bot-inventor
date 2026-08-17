/**
 * Sharing, as the editor sees it: somewhere outside the application's storage to
 * put a Project File, and the writing of it.
 *
 * The two are separated because only the first is a question for the user, and a
 * test has to be able to answer it without a dialog.
 *
 * Nothing here takes a Secret or a Test Server, and there is nowhere in the
 * shape for one to travel: what is shared is the Project and nothing else
 * (`CONTEXT.md`, Share). This is the seam that makes that true rather than
 * hoped for.
 */
export type ShareGateway = {
  /**
   * Asks the user where the Project File should go, or `undefined` when they
   * changed their mind.
   *
   * The name is a suggestion made from the Project's name, and the user is free
   * to type another — which is why this is a save dialog where an Export's
   * destination is a folder: the name an Export writes under is fixed (ADR
   * 0004), and a Project File's name is the user's.
   */
  chooseDestination(suggestedName: string): Promise<string | undefined>
  /** Writes the document at the path the user picked. It throws when it cannot. */
  write(path: string, document: string): Promise<void>
}

/** The extension a Project File carries, without its dot. */
export const PROJECT_FILE_EXTENSION = "botinv"

/**
 * The file name a Project is offered under, made from its name.
 *
 * Everything a file name cannot hold on Windows becomes a dash, and a name left
 * with nothing falls back to a plain one: a dialog opening with an empty name
 * reads as a broken dialog, and a Project may legitimately be called something
 * like `<3`.
 */
export function suggestedFileName(projectName: string): string {
  const cleaned = projectName
    // What Windows will not keep in a file name. A space is not one of them:
    // "My first bot" is the name the user gave it, and it survives as it is.
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    // Windows keeps neither a trailing dot nor a trailing space.
    .replace(/[. ]+$/, "")

  const stem = cleaned.length > 0 ? cleaned : "project"
  return `${stem}.${PROJECT_FILE_EXTENSION}`
}
