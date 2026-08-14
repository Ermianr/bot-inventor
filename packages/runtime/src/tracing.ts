import type { TraceSink } from "./runtime.js"

/**
 * The Tracing a Runtime hands to generated code.
 *
 * It lives apart from any particular Runtime because every Runtime needs the
 * same behaviour and none of them may be the one that forgets it: a run gets an
 * id, and a value that travelled down a Wire is turned into something a person
 * can read before it leaves the bot.
 */

/**
 * How much of one value the user is shown. A value long enough to fill the
 * Canvas tells them nothing the first line did not, and every trace event
 * crosses a pipe to get here.
 */
const VALUE_LIMIT = 200

/** What replaces the tail of a value that was longer than the limit. */
const ELLIPSIS = "…"

export type Tracing = {
  /** Allocates the id every event of one run is stamped with. */
  startRun(): number
  /**
   * Reports the value a Wire carried and hands it straight back, so generated
   * code can trace an input without restructuring the expression that reads it.
   */
  traceWire<T>(run: number, flow: string, wire: string, value: T): T
}

export function createTracing(sink: TraceSink): Tracing {
  // Runs are numbered rather than named because the Canvas has to tell a later
  // run from an earlier one: when two runs overlap, the newest is the one shown.
  let runs = 0

  return {
    startRun() {
      runs += 1
      return runs
    },
    traceWire(run, flow, wire, value) {
      sink({ kind: "wire-carried", run, flow, wire, value: describeValue(value) })
      return value
    }
  }
}

/**
 * Turns a value into the text the user reads on a Wire.
 *
 * Trace values are serialised for display and not for round-tripping: nothing
 * reads them back, so this may flatten a Discord user into a mention and cut a
 * long string short. It never throws — a value that cannot be described is
 * still a value that travelled, and losing the whole run over it would be the
 * worse answer.
 */
export function describeValue(value: unknown): string {
  const described = render(value)
  return described.length > VALUE_LIMIT
    ? described.slice(0, VALUE_LIMIT - ELLIPSIS.length) + ELLIPSIS
    : described
}

function render(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return "undefined"
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    return String(value)
  }

  try {
    // A cycle is what a Discord object arrives as; `undefined` comes back for a
    // value JSON has no rendering of at all.
    return JSON.stringify(value, replaceCycles()) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Keeps a value that points back at itself from taking the run down.
 *
 * What it watches is the way down to the value being written, not everything
 * seen so far: the same object appearing twice side by side is a value that
 * travelled, and writing the second one off as a cycle would show the user
 * something their bot never carried.
 */
function replaceCycles() {
  const path: unknown[] = []

  return function (this: unknown, _key: string, current: unknown): unknown {
    if (typeof current !== "object" || current === null) return current

    // `this` is what holds the value being written, so anything the walk has
    // already climbed back out of is no longer on the way down to it.
    while (path.length > 0 && path.at(-1) !== this) path.pop()
    if (path.includes(current)) return "[circular]"

    path.push(current)
    return current
  }
}
