/** An Export that could not be written, in either format. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExportError"
  }
}
