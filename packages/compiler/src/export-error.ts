/**
 * An Export that could not be written, in either format.
 *
 * `alreadyExists` is separated from every other failure because it is the one
 * the user can answer: an Export is already there, and going ahead would
 * replace it. Everything else is something they can only be told about.
 */
export class ExportError extends Error {
  /** Whether the only thing in the way is an Export that is already there. */
  readonly alreadyExists: boolean

  /**
   * What would be replaced — the file for a Single File, the folder for a Node
   * Project. It is carried rather than left for the caller to work out, because
   * the caller is about to put it in front of the user and asking about the
   * wrong thing is how somebody agrees to lose something they meant to keep.
   */
  readonly path: string | undefined

  constructor(message: string, options: { alreadyExists?: boolean; path?: string } = {}) {
    super(message)
    this.name = "ExportError"
    this.alreadyExists = options.alreadyExists === true
    this.path = options.path
  }
}
