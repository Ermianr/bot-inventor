import type { NodeDefinition } from "@bot-inventor/nodes"
import { describe, expect, it } from "vitest"

import type { FlowNodeType } from "@/canvas/flow-node"
import { minimapNodePaint } from "@/canvas/minimap"
import type { NodeRunState } from "@/session/trace"

/**
 * How a Node is drawn on the Minimap.
 *
 * The point of a map is telling one thing from another at a glance, so what is
 * held to here is that the three kinds of Node are three different colours —
 * not which colours they happen to be, which is the theme's business.
 */

function definition(isTrigger: boolean): NodeDefinition {
  return {
    id: isTrigger ? "discord.trigger.slashCommand" : "discord.interaction.reply",
    labelKey: "label",
    descriptionKey: "description",
    isTrigger,
    fields: [],
    ports: [],
    generate: () => ""
  }
}

function node(isTrigger: boolean, runState?: NodeRunState): FlowNodeType {
  return {
    id: "node-1",
    type: "flowNode",
    position: { x: 0, y: 0 },
    data: {
      node: { id: "node-1", type: definition(isTrigger).id, position: { x: 0, y: 0 }, fields: {} },
      definition: definition(isTrigger),
      runState,
      setField: () => {},
      slotLabel: () => "",
      slotIsWired: () => false,
      remove: () => {}
    }
  }
}

describe("a Node on the Minimap", () => {
  it("draws the Trigger apart from everything else", () => {
    expect(minimapNodePaint(node(true))).not.toBe(minimapNodePaint(node(false)))
  })

  it("marks a Node that failed in the last Run", () => {
    expect(minimapNodePaint(node(false, "failed"))).not.toBe(minimapNodePaint(node(false)))
  })

  /**
   * A Trigger that failed is a Flow that never started, and the failure is what
   * the user came to the map to find.
   */
  it("marks a Trigger that failed as a failure rather than as a Trigger", () => {
    expect(minimapNodePaint(node(true, "failed"))).toBe(minimapNodePaint(node(false, "failed")))
  })

  /**
   * The map is read after everything has stopped. A Node the run merely reached
   * is not news then, and colouring it would leave the failure competing for
   * the eye with every Node that went fine.
   */
  it("leaves a Node that ran without failing looking like any other", () => {
    for (const state of ["entered", "completed"] as const) {
      expect(minimapNodePaint(node(false, state))).toBe(minimapNodePaint(node(false)))
    }
  })

  it("paints every Node from the application's own tokens", () => {
    for (const drawn of [node(true), node(false), node(false, "failed")]) {
      expect(minimapNodePaint(drawn)).toMatch(/^var\(--[a-z-]+\)$/)
    }
  })
})
