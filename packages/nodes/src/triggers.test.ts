import { emptyProject, helloProject, requireFirst } from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import { catalogue } from "./catalogue.js"
import { hasTrigger } from "./triggers.js"

describe("whether a Flow ever runs", () => {
  it("says a Flow with a Trigger runs", () => {
    const flow = requireFirst(helloProject().flows, "Flow")

    expect(hasTrigger(flow, catalogue)).toBe(true)
  })

  it("says an empty Flow never runs", () => {
    const flow = requireFirst(emptyProject().flows, "Flow")

    expect(hasTrigger(flow, catalogue)).toBe(false)
  })

  it("says a Flow holding only Nodes that are not Triggers never runs", () => {
    const flow = requireFirst(helloProject().flows, "Flow")
    flow.nodes = flow.nodes.filter(node => node.type !== "discord.trigger.slashCommand")

    expect(hasTrigger(flow, catalogue)).toBe(false)
  })

  it("ignores a Node this build has no definition for", () => {
    const flow = requireFirst(helloProject().flows, "Flow")
    flow.nodes = flow.nodes.map(node => ({ ...node, type: "discord.trigger.fromTheFuture" }))

    expect(hasTrigger(flow, catalogue)).toBe(false)
  })
})
