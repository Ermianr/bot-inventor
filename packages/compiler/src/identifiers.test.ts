import type { Node } from "@bot-inventor/schema"
import { describe, expect, it } from "vitest"

import { assignIdentifierPrefixes, literal } from "./identifiers.js"

function nodesWithIds(ids: readonly string[]): Node[] {
  return ids.map(id => ({
    id,
    type: "discord.interaction.reply",
    position: { x: 0, y: 0 },
    fields: {}
  }))
}

describe("identifiers in generated code", () => {
  it("turns a Node id into something JavaScript accepts as a name", () => {
    const prefixes = assignIdentifierPrefixes(nodesWithIds(["node-reply", "1st"]))

    expect(prefixes.get("node-reply")).toBe("node_reply")
    expect(prefixes.get("1st")).toBe("_1st")
  })

  it("keeps two Node ids apart even when they sanitise to the same text", () => {
    const ids = ["a_b_2", "a.b", "a-b", "a b"]
    const prefixes = assignIdentifierPrefixes(nodesWithIds(ids))

    const assigned = ids.map(id => prefixes.get(id))
    expect(new Set(assigned).size).toBe(ids.length)
  })

  it("writes values as the JavaScript that reproduces them", () => {
    expect(literal('say "hi"')).toBe('"say \\"hi\\""')
    expect(literal(false)).toBe("false")
  })

  it("refuses a value that cannot be written into generated code", () => {
    expect(() => literal(undefined)).toThrowError(/cannot be written/)
  })
})
