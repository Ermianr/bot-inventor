/** What went wrong, as a line that can be put in front of the user. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
