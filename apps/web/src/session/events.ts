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

/**
 * Which bot an event came from.
 *
 * The Tauri side numbers every bot it starts, and a hot reload starts a new one
 * while the old one is still dying. Without this the old bot's exit reads as the
 * new one stopping and its last lines read as the new one's output, which is the
 * difference between a reload the user does not notice and a panel that keeps
 * announcing a bot that is running fine.
 */
export type SessionId = number

/** One line the bot wrote. `stderr` is what the panel shows as a problem. */
export type SessionOutputEvent = {
  session: SessionId
  stream: "stdout" | "stderr"
  line: string
}

/** The process is gone. `code` is absent when it was killed rather than exited. */
export type SessionExitEvent = { session: SessionId; code: number | null }
