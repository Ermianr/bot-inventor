import type { TraceEvent } from "@bot-inventor/compiler"

/**
 * The run the Canvas is showing.
 *
 * Tracing arrives as a stream of events and the Canvas needs a picture, so this
 * is what turns one into the other. It holds a single run: when a newer one
 * starts, the older one is dropped whole rather than drawn over, because two
 * runs mixed together on one Canvas is a picture of nothing that happened.
 */

/** How far a Node got in the run being shown. */
export type NodeRunState = "entered" | "completed" | "failed"

export type RunTrace = {
  /** Runs are numbered by the Runtime, and a larger number is a later run. */
  run: number
  /** The Flow that ran, so the Canvas only lights up the Flow being looked at. */
  flow: string
  nodes: Readonly<Record<string, NodeRunState>>
  /** What each Wire carried, as it arrived at the far end of it. */
  wires: Readonly<Record<string, string>>
  /** Why the run stopped, when it stopped. */
  failure: { node: string; message: string } | undefined
}

/** A Flow that stopped, as the Session reports it. */
export type FlowFailureMessage = {
  flow: string
  node: string
  message: string
  run?: number
}

/** Takes in one Tracing event and gives back the run to draw. */
export function watchTrace(current: RunTrace | undefined, event: TraceEvent): RunTrace | undefined {
  const run = runFor(current, event.run, event.flow)
  if (run === undefined) return current

  switch (event.kind) {
    case "node-entered":
      return { ...run, nodes: { ...run.nodes, [event.node]: "entered" } }
    case "node-completed":
      return { ...run, nodes: { ...run.nodes, [event.node]: "completed" } }
    case "wire-carried":
      return { ...run, wires: { ...run.wires, [event.wire]: event.value } }
  }
}

/**
 * Marks the run that stopped and the Node it stopped at.
 *
 * A failure with no run belongs to no Node — the bot broke outside any Flow of
 * its own — and the Canvas is left as it was; the panel is where that is told.
 */
export function watchFailure(
  current: RunTrace | undefined,
  failure: FlowFailureMessage
): RunTrace | undefined {
  if (failure.run === undefined) return current

  const run = runFor(current, failure.run, failure.flow)
  if (run === undefined) return current

  return {
    ...run,
    nodes: { ...run.nodes, [failure.node]: "failed" },
    failure: { node: failure.node, message: failure.message }
  }
}

/**
 * The run an event belongs to: the one being shown, a fresh one when the event
 * is from a later run, or nothing at all when it is from an earlier one.
 *
 * An event from a run already left behind is dropped rather than drawn: the
 * slower of two overlapping runs keeps reporting after the newer one is on
 * screen, and that is exactly the flicker there is nothing to see in.
 */
function runFor(current: RunTrace | undefined, run: number, flow: string): RunTrace | undefined {
  if (current === undefined || run > current.run) {
    return { run, flow, nodes: {}, wires: {}, failure: undefined }
  }
  return run === current.run ? current : undefined
}
