import type { TraceEvent } from "@bot-inventor/compiler"
import { describe, expect, it } from "vitest"

import { type RunTrace, watchFailure, watchTrace } from "@/session/trace"

const entered = (run: number, node: string): TraceEvent => ({
  kind: "node-entered",
  run,
  flow: "flow-greet",
  node
})

const completed = (run: number, node: string): TraceEvent => ({
  kind: "node-completed",
  run,
  flow: "flow-greet",
  node
})

const carried = (run: number, wire: string, value: string): TraceEvent => ({
  kind: "wire-carried",
  run,
  flow: "flow-greet",
  wire,
  value
})

/** Reads a stream of events the way the editor does, from nothing. */
function watch(events: readonly TraceEvent[]): RunTrace | undefined {
  return events.reduce<RunTrace | undefined>(
    (current, event) => watchTrace(current, event),
    undefined
  )
}

describe("following one run", () => {
  it("marks a Node as running when it is entered and as done when it finishes", () => {
    const trace = watch([entered(1, "node-trigger"), completed(1, "node-trigger")])

    expect(trace?.nodes["node-trigger"]).toBe("completed")
  })

  it("leaves a Node that has not finished showing as running", () => {
    const trace = watch([
      entered(1, "node-trigger"),
      completed(1, "node-trigger"),
      entered(1, "node-reply")
    ])

    expect(trace?.nodes).toEqual({ "node-trigger": "completed", "node-reply": "entered" })
  })

  it("keeps what each Wire carried, so the user can read it off the Canvas", () => {
    const trace = watch([entered(1, "node-reply"), carried(1, "wire-data", "<@42>")])

    expect(trace?.wires["wire-data"]).toBe("<@42>")
  })

  it("holds the Flow the run belongs to, because the Canvas shows one at a time", () => {
    expect(watch([entered(1, "node-trigger")])?.flow).toBe("flow-greet")
  })
})

describe("runs that follow one another quickly", () => {
  it("shows the newest run rather than mixing it with the one before", () => {
    const trace = watch([
      entered(1, "node-trigger"),
      completed(1, "node-trigger"),
      carried(1, "wire-data", "<@1>"),
      entered(2, "node-trigger"),
      carried(2, "wire-data", "<@2>")
    ])

    expect(trace?.run).toBe(2)
    expect(trace?.nodes).toEqual({ "node-trigger": "entered" })
    expect(trace?.wires).toEqual({ "wire-data": "<@2>" })
  })

  it("ignores what an earlier run reports after a later one has started", () => {
    // Two runs overlap whenever two people use the command at once, and the
    // slower one keeps talking after the newer one is on screen.
    const trace = watch([
      entered(2, "node-reply"),
      completed(1, "node-reply"),
      carried(1, "wire-data", "stale")
    ])

    expect(trace).toEqual({
      run: 2,
      flow: "flow-greet",
      nodes: { "node-reply": "entered" },
      wires: {},
      failure: undefined
    })
  })
})

describe("a run that failed", () => {
  it("marks the Node it stopped at", () => {
    const trace = watchFailure(watch([entered(1, "node-reply")]), {
      kind: "flow-failed",
      run: 1,
      flow: "flow-greet",
      node: "node-reply",
      message: "the bot cannot write in this channel"
    })

    expect(trace?.nodes["node-reply"]).toBe("failed")
    expect(trace?.failure).toEqual({
      node: "node-reply",
      message: "the bot cannot write in this channel"
    })
  })

  it("leaves the Canvas alone when the failure belongs to no run", () => {
    // A bot that broke outside any Flow of its own has nothing to point at, and
    // marking the run on screen would blame a Node that did nothing wrong.
    const watching = watch([entered(2, "node-reply")])

    expect(
      watchFailure(watching, {
        kind: "flow-failed",
        flow: "",
        node: "",
        message: "the gateway closed"
      })
    ).toEqual(watching)
  })

  it("ignores a failure from a run that is no longer the one shown", () => {
    const watching = watch([entered(2, "node-reply")])

    expect(
      watchFailure(watching, {
        kind: "flow-failed",
        run: 1,
        flow: "flow-greet",
        node: "node-reply",
        message: "gone"
      })
    ).toEqual(watching)
  })
})
