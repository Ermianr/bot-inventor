import { describe, expect, it } from "vitest"
import type { TraceEvent } from "./runtime.js"
import { createTracing, describeValue } from "./tracing.js"

describe("numbering runs", () => {
  it("gives every run an id later than the one before it", () => {
    const tracing = createTracing(() => {})

    expect(tracing.startRun()).toBe(1)
    expect(tracing.startRun()).toBe(2)
  })
})

describe("reporting what a Wire carried", () => {
  it("hands the value straight back so the expression reading it is unchanged", () => {
    const tracing = createTracing(() => {})

    expect(tracing.traceWire(1, "flow-hello", "wire-data", "Ana")).toBe("Ana")
  })

  it("reports the value against the Wire and the run it travelled in", () => {
    const events: TraceEvent[] = []
    const tracing = createTracing(event => events.push(event))

    tracing.traceWire(7, "flow-hello", "wire-data", "Ana")

    expect(events).toEqual([
      { kind: "wire-carried", run: 7, flow: "flow-hello", wire: "wire-data", value: "Ana" }
    ])
  })
})

describe("describing a value for the user", () => {
  it("shows text as itself", () => {
    expect(describeValue("hello @Ana")).toBe("hello @Ana")
  })

  it("shows the numbers, switches and blanks a Node can carry", () => {
    expect(describeValue(3)).toBe("3")
    expect(describeValue(true)).toBe("true")
    expect(describeValue(null)).toBe("null")
    expect(describeValue(undefined)).toBe("undefined")
  })

  it("describes a Discord user by what it holds", () => {
    expect(describeValue({ id: "42", username: "ana", displayName: "Ana" })).toContain("Ana")
  })

  it("cuts a value nobody could read short", () => {
    const described = describeValue("a".repeat(5_000))

    expect(described.length).toBeLessThan(250)
    expect(described.endsWith("…")).toBe(true)
  })

  it("survives a value that points back at itself", () => {
    const looping: Record<string, unknown> = { name: "Ana" }
    looping.self = looping

    expect(describeValue(looping)).toContain("Ana")
  })
})
