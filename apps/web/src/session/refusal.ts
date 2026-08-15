import { translate } from "@/i18n/messages"

/**
 * How the Tauri side refuses anything that needed the token.
 *
 * The three cases are separated because the user's next move differs for each
 * one: paste a token, paste a different token, or none of the above. It is
 * declared in `src-tauri/src/secrets.rs` as well, because Rust cannot read this
 * file.
 */
export type Refusal =
  | { kind: "missing-secret" }
  | { kind: "rejected" }
  | { kind: "failed"; message: string }
  /**
   * The one that does not come from Rust: there is no desktop shell to refuse.
   * The Canvas runs in a plain browser too, and pressing Run there has to say
   * so rather than throw somewhere the user never sees.
   */
  | { kind: "no-desktop" }

/** Turns a refusal into something the user can act on. */
export function describeRefusal(error: unknown): string {
  const refusal = error as Refusal | undefined

  switch (refusal?.kind) {
    case "missing-secret":
      return translate("run.failure.missingSecret")
    case "rejected":
      return translate("run.failure.token")
    case "failed":
      return translate("run.failure.unknown", { message: refusal.message })
    case "no-desktop":
      return translate("run.failure.noDesktop")
    default:
      // Something that is not a refusal at all: the command is not there, the
      // arguments did not match. The user cannot fix it, but hiding it would
      // leave them with a button that does nothing and says nothing.
      return translate("run.failure.unknown", { message: String(error) })
  }
}
