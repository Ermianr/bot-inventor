import { describe, expect, it } from "vitest"
import { embeds } from "./embed.js"

/**
 * The builder generated code calls. What it hands back is what reaches Discord,
 * so what it leaves out matters as much as what it keeps.
 */
describe("building an Embed", () => {
  it("keeps the title, the description and the colour it was given", () => {
    expect(embeds.build({ title: "Rules", description: "Be kind.", colour: 5793266 })).toEqual({
      title: "Rules",
      description: "Be kind.",
      colour: 5793266
    })
  })

  it("leaves out a part the user never typed, rather than sending it empty", () => {
    expect(embeds.build({ title: "", description: "Only this", colour: 0 })).toEqual({
      description: "Only this",
      colour: 0
    })
  })

  it("is an empty Embed when nothing was typed into it at all", () => {
    expect(embeds.build({})).toEqual({})
  })

  it("cuts a title and a description down to the length Discord accepts", () => {
    const built = embeds.build({ title: "a".repeat(300), description: "b".repeat(5000) })

    expect(built.title).toHaveLength(256)
    expect(built.description).toHaveLength(4096)
  })

  it("brings a colour a hand-edited Project holds back into range", () => {
    expect(embeds.build({ colour: -1 }).colour).toBe(0)
    expect(embeds.build({ colour: 0x1000000 }).colour).toBe(0xffffff)
    expect(embeds.build({ colour: 16.7 }).colour).toBe(16)
  })

  it("leaves out a colour that is not a number at all", () => {
    expect(embeds.build({ colour: "blurple" })).toEqual({})
    expect(embeds.build({ colour: Number.NaN })).toEqual({})
  })
})
