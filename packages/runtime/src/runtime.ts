import type { Coercions } from "./coercions.js"
import type { DiscordRuntime } from "./discord.js"

/**
 * A Flow that stopped because an action could not be completed and its Failure
 * Port was not connected.
 */
export type FlowFailure = {
  flow: string
  /** The Node instance that was running when it failed. */
  node: string
  error: unknown
}

/**
 * What Development Mode's Tracing reports back to the Canvas. Build mode emits
 * no calls to the trace sink at all.
 */
export type TraceEvent =
  | { kind: "node-entered"; flow: string; node: string }
  | { kind: "value-produced"; flow: string; node: string; port: string; value: unknown }

/**
 * Everything generated code is handed. It is the only thing generated code
 * knows about — no discord.js import, no global state — which is what makes a
 * Project runnable against a fake client in a test.
 */
export type Runtime = {
  readonly discord: DiscordRuntime
  readonly coerce: Coercions
  /** Records a stopped Flow. Called by generated code, never thrown past. */
  reportFailure(failure: FlowFailure): void
  /** Tracing sink. Only Development Mode's generated code calls it. */
  trace(event: TraceEvent): void
  /** Connects to Discord and starts serving. */
  start(): Promise<void>
  stop(): Promise<void>
}
