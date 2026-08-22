import { describe, expect, it } from "bun:test"

import { emptyProject, helloProject, requireFirst } from "@bot-inventor/schema/fixtures"

import { catalogue } from "./catalogue.js"
import { addableNodes, hasTrigger } from "./triggers.js"

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

describe("which Nodes a Flow can still be given", () => {
  const triggers = [...catalogue.values()].filter(definition => definition.isTrigger)

  it("offers every Node of the catalogue to a Flow with no Trigger", () => {
    const flow = requireFirst(emptyProject().flows, "Flow")

    const choices = addableNodes(flow, catalogue)

    expect(choices).toHaveLength(catalogue.size)
    expect(choices.every(choice => choice.addable)).toBe(true)
  })

  it("refuses a second Trigger in a Flow that has one, and says why", () => {
    const flow = requireFirst(helloProject().flows, "Flow")

    const choices = addableNodes(flow, catalogue)
    const refused = choices.filter(choice => !choice.addable)

    expect(refused.map(choice => choice.definition.id)).toEqual(
      triggers.map(definition => definition.id)
    )
    for (const choice of refused) {
      expect(choice.refusalKey).toBe("catalogue.rejected.triggerTaken")
    }
  })

  it("keeps every Node that is not a Trigger available in a Flow that has one", () => {
    const flow = requireFirst(helloProject().flows, "Flow")

    const choices = addableNodes(flow, catalogue)

    for (const choice of choices.filter(candidate => !candidate.definition.isTrigger)) {
      expect(choice.addable).toBe(true)
      expect(choice.refusalKey).toBeUndefined()
    }
  })

  it("keeps offering a Trigger to a Flow whose only Node this build cannot read", () => {
    // The same answer `hasTrigger` gives: a Node the Compiler will refuse is no
    // reason to tell the user their Flow already starts somewhere.
    const flow = requireFirst(helloProject().flows, "Flow")
    flow.nodes = flow.nodes.map(node => ({ ...node, type: "discord.trigger.fromTheFuture" }))

    const choices = addableNodes(flow, catalogue)

    expect(choices.every(choice => choice.addable)).toBe(true)
  })
})
