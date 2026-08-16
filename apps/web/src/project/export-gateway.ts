import type { ExportFormat, ExportRequest, ExportResult } from "@bot-inventor/compiler"

/**
 * Exporting, as the editor sees it: somewhere to put it, permission to replace
 * what is there, and the doing of it.
 *
 * The three are separated because only the middle one is a question for the
 * user, and a test has to be able to answer it without a dialog. Compiling and
 * bundling happen on the sidecar (ADR 0007); nothing above this knows that.
 */
export type ExportGateway = {
  /**
   * Asks the user which folder the Export should go in, or `undefined` if they
   * changed their mind. The format is passed because it changes what the
   * dialog says, not what it returns.
   */
  chooseDestination(format: ExportFormat): Promise<string | undefined>
  /**
   * Asks whether an Export that is already there may be replaced. Answering no
   * leaves it exactly as it was.
   */
  confirmOverwrite(path: string): Promise<boolean>
  /** Performs the Export and says what happened. It does not throw for a refusal. */
  run(request: ExportRequest): Promise<ExportResult>
  /**
   * Shows the user an Export that was written, in whatever the machine has for
   * looking at files.
   *
   * Optional, because it is the one thing here that only a desktop shell can
   * do: a plain browser cannot open a file manager, and the editor runs in one
   * during development and under the end-to-end tests. Absent means the offer
   * is never made, rather than made and doing nothing.
   */
  show?(path: string): Promise<void>
}
