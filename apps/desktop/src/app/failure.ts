import { BackendError } from "../services/TauriBackend";
import { m } from "../paraglide/messages.js";

/**
 * The text to show for a failed backend call. A message from Rust (it names a path or a limit,
 * never a secret) is shown as it is; anything else gets a generic text.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof BackendError)) return m.error_backend();
  const cause: unknown = error.cause;
  if (typeof cause === "object" && cause !== null && "kind" in cause) {
    if (cause.kind === "no_project") return m.error_no_project();
    if ("message" in cause && typeof cause.message === "string") {
      return cause.message;
    }
  }
  return m.error_backend();
}
