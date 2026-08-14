/**
 * The events the Tauri side emits while a Session runs.
 *
 * They are declared in `src-tauri/src/session.rs` as well, because Rust cannot
 * read this file: these two lists are the whole contract between the process
 * that owns the bot and the editor watching it, so anything renamed here has to
 * be renamed there in the same change.
 */

/** A line the bot wrote, already stripped of the token. */
export const OUTPUT_EVENT = "session://output"

/** The bot's process is gone, for any reason including Stop. */
export const EXIT_EVENT = "session://exited"

/** One line the bot wrote. `stderr` is what the panel shows as a problem. */
export type SessionOutputEvent = { stream: "stdout" | "stderr"; line: string }

/** The process is gone. `code` is absent when it was killed rather than exited. */
export type SessionExitEvent = { code: number | null }
