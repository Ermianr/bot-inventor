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

  constructor(message: string, options: { alreadyExists?: boolean } = {}) {
    super(message)
    this.name = "ExportError"
    this.alreadyExists = options.alreadyExists === true
  }
}
