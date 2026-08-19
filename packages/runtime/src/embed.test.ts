import { describe, expect, it } from "vitest"
import { toDiscordEmbed } from "./discord-js-runtime.js"
import { buildEmbed, checkEmbed, describeEmbedProblem, embeds } from "./embed.js"

/**
 * The builder generated code calls. What it hands back is what reaches Discord,
 * so what it leaves out matters as much as what it keeps.
 */
describe("building an Embed", () => {
  it("keeps the title, the description and the colour it was given", () => {
    expect(buildEmbed({ title: "Rules", description: "Be kind.", colour: 5793266 })).toEqual({
      title: "Rules",
      description: "Be kind.",
      colour: 5793266
    })
  })

  it("leaves out a part the user never typed, rather than sending it empty", () => {
    expect(buildEmbed({ title: "", description: "Only this", colour: 0 })).toEqual({
      description: "Only this",
      colour: 0
    })
  })

  it("is an empty Embed when nothing was typed into it at all", () => {
    expect(buildEmbed({})).toEqual({})
  })

  it("keeps a title and a description whole, however long they are", () => {
    const built = buildEmbed({ title: "a".repeat(300), description: "b".repeat(5000) })

    // Nothing is cut: what is too long is what the user is told about, and a
    // length that has already been cut has nothing left to tell them.
    expect(built.title).toHaveLength(300)
    expect(built.description).toHaveLength(5000)
  })

  it("brings a colour a hand-edited Project holds back into range", () => {
    expect(buildEmbed({ colour: -1 }).colour).toBe(0)
    expect(buildEmbed({ colour: 0x1000000 }).colour).toBe(0xffffff)
    expect(buildEmbed({ colour: 16.7 }).colour).toBe(16)
  })

  it("leaves out a colour that is not a number at all", () => {
    expect(buildEmbed({ colour: "blurple" })).toEqual({})
    expect(buildEmbed({ colour: Number.NaN })).toEqual({})
  })

  it("keeps the author, its link and its icon together", () => {
    expect(
      buildEmbed({
        authorName: "Ada",
        authorUrl: "https://example.com/ada",
        authorIcon: "https://example.com/ada.png"
      }).author
    ).toEqual({
      name: "Ada",
      url: "https://example.com/ada",
      icon: "https://example.com/ada.png"
    })
  })

  it("leaves out an author with no name, link and icon included", () => {
    expect(
      buildEmbed({
        authorUrl: "https://example.com/ada",
        authorIcon: "https://example.com/a.png"
      })
    ).toEqual({})
  })

  it("keeps the footer and its icon, and leaves out a footer with no text", () => {
    expect(
      buildEmbed({ footerText: "Rule 1", footerIcon: "https://example.com/i.png" }).footer
    ).toEqual({ text: "Rule 1", icon: "https://example.com/i.png" })
    expect(buildEmbed({ footerIcon: "https://example.com/i.png" })).toEqual({})
  })

  it("keeps the Embed Fields in the order they were written, inline included", () => {
    expect(
      buildEmbed({
        embedFields: [
          { name: "Rule 1", value: "Be kind", inline: true },
          { name: "Rule 2", value: "Be brief", inline: false }
        ]
      }).embedFields
    ).toEqual([
      { name: "Rule 1", value: "Be kind", inline: true },
      { name: "Rule 2", value: "Be brief", inline: false }
    ])
  })

  it("leaves out an Embed Field missing its name or its value, and keeps the rest", () => {
    expect(
      buildEmbed({
        embedFields: [
          { name: "", value: "Be kind" },
          { name: "Rule 2", value: "" },
          { name: "Rule 3", value: "Be brief" }
        ]
      }).embedFields
    ).toEqual([{ name: "Rule 3", value: "Be brief", inline: false }])
  })

  it("has no Embed Fields at all when none of them could be sent", () => {
    expect(buildEmbed({ embedFields: [{ name: "Rule 1", value: "" }] })).toEqual({})
    expect(buildEmbed({ embedFields: "Rule 1" })).toEqual({})
  })

  it("keeps every Embed Field it was given, whole and however many there are", () => {
    const written = Array.from({ length: 30 }, (_, index) => ({
      name: `Rule ${index}`,
      value: "Be kind"
    }))

    expect(buildEmbed({ embedFields: written }).embedFields).toHaveLength(30)
  })

  it("keeps the large image and the thumbnail as the URLs they were given as", () => {
    expect(
      buildEmbed({ image: "https://example.com/big.png", thumbnail: "https://example.com/s.png" })
    ).toEqual({ image: "https://example.com/big.png", thumbnail: "https://example.com/s.png" })
  })

  it("links the title, and leaves the link out when there is no title to click", () => {
    expect(buildEmbed({ title: "Rules", url: "https://example.com/rules" })).toEqual({
      title: "Rules",
      url: "https://example.com/rules"
    })
    expect(buildEmbed({ url: "https://example.com/rules" })).toEqual({})
  })

  it("drops what is not a public link rather than sending an Embed Discord refuses", () => {
    expect(
      buildEmbed({
        title: "Rules",
        url: "example.com/rules",
        image: "  ",
        thumbnail: "javascript:alert(1)",
        authorName: "Ada",
        authorIcon: "not a url"
      })
    ).toEqual({ title: "Rules", author: { name: "Ada" } })
  })

  it("stamps the Embed with the time it was sent when the switch is on", () => {
    const before = Date.now()
    const stamped = buildEmbed({ timestamp: true }).timestamp

    expect(stamped).toBeDefined()
    expect(Date.parse(stamped ?? "")).toBeGreaterThanOrEqual(before)
  })

  it("stamps nothing when the switch is off", () => {
    expect(buildEmbed({ timestamp: false })).toEqual({})
    expect(buildEmbed({})).toEqual({})
  })

  it("keeps an author name and a footer text whole, however long they are", () => {
    const built = buildEmbed({ authorName: "a".repeat(300), footerText: "b".repeat(3000) })

    expect(built.author?.name).toHaveLength(300)
    expect(built.footer?.text).toHaveLength(3000)
  })
})

/**
 * The one reading of Discord's limits. The editor calls this while the user
 * types and the generated code reaches it through the builder, so what is
 * tested here is what both of them enforce.
 */
describe("checking an Embed against Discord's limits", () => {
  it("passes an Embed that is inside every limit", () => {
    expect(checkEmbed(buildEmbed({ title: "Rules", description: "Be kind." }))).toEqual([])
  })

  it("reports each text part that is over its own limit", () => {
    const problems = checkEmbed(
      buildEmbed({
        title: "a".repeat(257),
        authorName: "b".repeat(257),
        footerText: "c".repeat(2049)
      })
    )
    const parts = problems.map(problem =>
      problem.kind === "too-long" ? problem.part : problem.kind
    )

    expect(problems).toContainEqual({
      kind: "too-long",
      part: "title",
      index: undefined,
      limit: 256,
      length: 257
    })
    expect(parts).toContain("authorName")
    expect(parts).toContain("footerText")
  })

  it("reports a description over four thousand and ninety-six", () => {
    expect(checkEmbed(buildEmbed({ description: "a".repeat(4097) }))).toContainEqual({
      kind: "too-long",
      part: "description",
      index: undefined,
      limit: 4096,
      length: 4097
    })
  })

  it("names the pair whose name or value is too long, counted from one", () => {
    const problems = checkEmbed(
      buildEmbed({
        embedFields: [
          { name: "Rule 1", value: "Be kind" },
          { name: "a".repeat(257), value: "b".repeat(1025) }
        ]
      })
    )

    expect(problems).toContainEqual({
      kind: "too-long",
      part: "embedFieldName",
      index: 2,
      limit: 256,
      length: 257
    })
    expect(problems).toContainEqual({
      kind: "too-long",
      part: "embedFieldValue",
      index: 2,
      limit: 1024,
      length: 1025
    })
  })

  it("reports more than the twenty-five pairs Discord accepts", () => {
    const written = Array.from({ length: 26 }, (_, index) => ({
      name: `Rule ${index}`,
      value: "Be kind"
    }))

    expect(checkEmbed(buildEmbed({ embedFields: written }))).toContainEqual({
      kind: "too-many-embed-fields",
      limit: 25,
      count: 26
    })
  })

  it("reports an Embed over the six thousand characters Discord budgets it", () => {
    const problems = checkEmbed(
      buildEmbed({ description: "a".repeat(4096), footerText: "b".repeat(1905) })
    )

    expect(problems).toContainEqual({
      kind: "too-long",
      part: "total",
      index: undefined,
      limit: 6000,
      length: 6001
    })
  })

  it("counts no link and no colour against the total", () => {
    const inside = buildEmbed({
      title: "Rules",
      description: "a".repeat(4096),
      footerText: "b".repeat(1899),
      url: "https://example.com/rules",
      colour: 0x5865f2
    })

    expect(checkEmbed(inside)).toEqual([])
  })

  it("reports an Embed with nothing in it", () => {
    expect(checkEmbed(buildEmbed({}))).toContainEqual({ kind: "empty" })
    expect(checkEmbed(buildEmbed({ colour: 0x5865f2, timestamp: true }))).toContainEqual({
      kind: "empty"
    })
  })

  it("takes a picture or a pair alone as something to draw", () => {
    expect(checkEmbed(buildEmbed({ image: "https://example.com/big.png" }))).toEqual([])
    expect(checkEmbed(buildEmbed({ embedFields: [{ name: "Rule 1", value: "Be kind" }] }))).toEqual(
      []
    )
  })

  it("says every problem in words a person can act on", () => {
    expect(describeEmbedProblem({ kind: "empty" })).toContain("nothing in it")
    expect(describeEmbedProblem({ kind: "too-long", part: "title", limit: 256, length: 300 })).toBe(
      "the embed's title is 300 characters long, and Discord allows 256"
    )
    expect(
      describeEmbedProblem({
        kind: "too-long",
        part: "embedFieldValue",
        index: 2,
        limit: 1024,
        length: 2000
      })
    ).toBe("the embed's value of pair 2 is 2000 characters long, and Discord allows 1024")
    expect(describeEmbedProblem({ kind: "too-many-embed-fields", limit: 25, count: 30 })).toBe(
      "the embed has 30 pairs, and Discord allows 25"
    )
  })
})

/**
 * What the generated code calls. It builds and checks in one go, because a bot
 * has nobody to show a problem to: an Embed Discord would refuse stops the run
 * instead, and the reason leaves by the Failure Port.
 */
describe("the builder generated code calls", () => {
  it("hands back the Embed when it is one Discord accepts", () => {
    expect(embeds.build({ title: "Rules" })).toEqual({ title: "Rules" })
  })

  it("refuses a value that arrived too long, saying which part and by how much", () => {
    expect(() => embeds.build({ title: "a".repeat(300) })).toThrow(
      "the embed's title is 300 characters long, and Discord allows 256"
    )
  })

  it("refuses an Embed with nothing in it", () => {
    expect(() => embeds.build({})).toThrow("nothing in it")
  })
})

/**
 * The one place Discord's own spelling is written. A rename got wrong here
 * sends an Embed with no colour bar and nothing at all saying why, and no test
 * of the builder would catch it.
 */
describe("handing an Embed to Discord", () => {
  it("sends our colour under the name Discord's API knows it by", () => {
    expect(toDiscordEmbed({ title: "Rules", description: "Be kind.", colour: 5793266 })).toEqual({
      title: "Rules",
      description: "Be kind.",
      color: 5793266
    })
  })

  it("sends every part under the name Discord's API knows it by", () => {
    expect(
      toDiscordEmbed({
        title: "Rules",
        url: "https://example.com/rules",
        author: { name: "Ada", url: "https://example.com/ada", icon: "https://example.com/a.png" },
        image: "https://example.com/big.png",
        thumbnail: "https://example.com/small.png",
        footer: { text: "Rule 1", icon: "https://example.com/i.png" },
        timestamp: "2026-08-18T10:00:00.000Z"
      })
    ).toEqual({
      title: "Rules",
      url: "https://example.com/rules",
      author: {
        name: "Ada",
        url: "https://example.com/ada",
        icon_url: "https://example.com/a.png"
      },
      image: { url: "https://example.com/big.png" },
      thumbnail: { url: "https://example.com/small.png" },
      footer: { text: "Rule 1", icon_url: "https://example.com/i.png" },
      timestamp: "2026-08-18T10:00:00.000Z"
    })
  })

  it("sends the Embed Fields under the name Discord's API knows them by", () => {
    expect(
      toDiscordEmbed({
        embedFields: [
          { name: "Rule 1", value: "Be kind", inline: true },
          { name: "Rule 2", value: "Be brief", inline: false }
        ]
      })
    ).toEqual({
      fields: [
        { name: "Rule 1", value: "Be kind", inline: true },
        { name: "Rule 2", value: "Be brief", inline: false }
      ]
    })
  })

  it("sends an author and a footer with no picture of their own", () => {
    expect(toDiscordEmbed({ author: { name: "Ada" }, footer: { text: "Rule 1" } })).toEqual({
      author: { name: "Ada" },
      footer: { text: "Rule 1" }
    })
  })

  it("sends no colour at all for an Embed that has none", () => {
    const sent = toDiscordEmbed({ title: "Rules" })

    expect(sent).toEqual({ title: "Rules" })
    expect("color" in sent).toBe(false)
  })
})
