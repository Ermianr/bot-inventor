import type { SessionExitEvent, SessionId, SessionOutputEvent } from "@/session/events"

/**
 * The Tauri side of a Session, as everything above it sees it.
 *
 * A bot's process, its lifetime and its output belong to Rust; what the editor
 * needs of all that is four things, and they are named here so that the hook
 * that decides *when* to start a bot can be read, and tested, without a desktop
 * shell around it. `desktop-session.ts` is the one that speaks to Tauri.
 */
export type SessionGateway = {
  /**
   * Runs the entry point the Compiler rendered, under the number the caller
   * gives it. Starting again stops whatever was running first — which is what a
   * hot reload relies on — so the previous number goes dead here.
   */
  start(request: { projectId: string; entry: string; session: SessionId }): Promise<void>
  stop(): Promise<void>
  /** Listens for the bot's output. Returns how to stop listening. */
  onOutput(listen: (event: SessionOutputEvent) => void): () => void
  /** Listens for a bot's process ending, for any reason including Stop. */
  onExit(listen: (event: SessionExitEvent) => void): () => void
}
