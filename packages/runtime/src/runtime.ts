import type { Coercions } from "./coercions.js"
import type { DiscordRuntime } from "./discord.js"
import type { Embeds } from "./embed.js"
import type { Tracing } from "./tracing.js"

/**
 * A Flow that stopped because an action could not be completed and its Failure
 * Port was not connected.
 */
export type FlowFailure = {
  flow: string
  /** The Node instance that was running when it failed. */
  node: string
  error: unknown
  /**
   * The run that failed, so the Canvas can mark the Node it stopped at. Only
   * Development Mode's generated code knows it: a Build numbers no runs.
   */
  run?: number
}

/**
 * What Development Mode's Tracing reports back to the Canvas. Build mode emits
 * no calls to the trace sink at all.
 *
 * Every event carries the run it belongs to, because two people can use the
 * same command at the same time and the Canvas shows one of those runs, whole.
 * A value is already text by the time it is in here: Tracing serialises for
 * display, and nothing reads one back.
 */
export type TraceEvent =
  | { kind: "node-entered"; run: number; flow: string; node: string }
  | { kind: "node-completed"; run: number; flow: string; node: string }
  | { kind: "wire-carried"; run: number; flow: string; wire: string; value: string }

/** Where trace events go. */
export type TraceSink = (event: TraceEvent) => void

/**
 * Everything generated code is handed. It is the only thing generated code
 * knows about — no discord.js import, no global state — which is what makes a
 * Project runnable against a fake client in a test.
 */
export type Runtime = Tracing & {
  readonly discord: DiscordRuntime
  readonly coerce: Coercions
  /** Builds the Embeds Nodes send, normalised into what Discord accepts. */
  readonly embed: Embeds
  /** Records a stopped Flow. Called by generated code, never thrown past. */
  reportFailure(failure: FlowFailure): void
  /**
   * Tracing sink. Only Development Mode's generated code calls it, and only for
   * the events it can state outright; a Wire's value goes through `traceWire`.
   */
  trace(event: TraceEvent): void
  /** Connects to Discord and starts serving. */
  start(): Promise<void>
  stop(): Promise<void>
}
