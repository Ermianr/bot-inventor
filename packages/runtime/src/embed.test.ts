import { describe, expect, it } from "vitest"
import { toDiscordEmbed } from "./discord-js-runtime.js"
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

  it("keeps the author, its link and its icon together", () => {
    expect(
      embeds.build({
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
      embeds.build({
        authorUrl: "https://example.com/ada",
        authorIcon: "https://example.com/a.png"
      })
    ).toEqual({})
  })

  it("keeps the footer and its icon, and leaves out a footer with no text", () => {
    expect(
      embeds.build({ footerText: "Rule 1", footerIcon: "https://example.com/i.png" }).footer
    ).toEqual({ text: "Rule 1", icon: "https://example.com/i.png" })
    expect(embeds.build({ footerIcon: "https://example.com/i.png" })).toEqual({})
  })

  it("keeps the Embed Fields in the order they were written, inline included", () => {
    expect(
      embeds.build({
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
      embeds.build({
        embedFields: [
          { name: "", value: "Be kind" },
          { name: "Rule 2", value: "" },
          { name: "Rule 3", value: "Be brief" }
        ]
      }).embedFields
    ).toEqual([{ name: "Rule 3", value: "Be brief", inline: false }])
  })

  it("has no Embed Fields at all when none of them could be sent", () => {
    expect(embeds.build({ embedFields: [{ name: "Rule 1", value: "" }] })).toEqual({})
    expect(embeds.build({ embedFields: "Rule 1" })).toEqual({})
  })

  it("cuts an Embed Field down to the lengths Discord accepts", () => {
    const built = embeds.build({
      embedFields: [{ name: "a".repeat(300), value: "b".repeat(2000) }]
    })

    expect(built.embedFields?.[0]?.name).toHaveLength(256)
    expect(built.embedFields?.[0]?.value).toHaveLength(1024)
  })

  it("stops at the twenty-five Embed Fields Discord accepts", () => {
    const written = Array.from({ length: 30 }, (_, index) => ({
      name: `Rule ${index}`,
      value: "Be kind"
    }))

    expect(embeds.build({ embedFields: written }).embedFields).toHaveLength(25)
  })

  it("keeps the large image and the thumbnail as the URLs they were given as", () => {
    expect(
      embeds.build({ image: "https://example.com/big.png", thumbnail: "https://example.com/s.png" })
    ).toEqual({ image: "https://example.com/big.png", thumbnail: "https://example.com/s.png" })
  })

  it("links the title, and leaves the link out when there is no title to click", () => {
    expect(embeds.build({ title: "Rules", url: "https://example.com/rules" })).toEqual({
      title: "Rules",
      url: "https://example.com/rules"
    })
    expect(embeds.build({ url: "https://example.com/rules" })).toEqual({})
  })

  it("drops what is not a public link rather than sending an Embed Discord refuses", () => {
    expect(
      embeds.build({
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
    const stamped = embeds.build({ timestamp: true }).timestamp

    expect(stamped).toBeDefined()
    expect(Date.parse(stamped ?? "")).toBeGreaterThanOrEqual(before)
  })

  it("stamps nothing when the switch is off", () => {
    expect(embeds.build({ timestamp: false })).toEqual({})
    expect(embeds.build({})).toEqual({})
  })

  it("cuts an author name and a footer text down to the length Discord accepts", () => {
    const built = embeds.build({ authorName: "a".repeat(300), footerText: "b".repeat(3000) })

    expect(built.author?.name).toHaveLength(256)
    expect(built.footer?.text).toHaveLength(2048)
  })

  it("keeps a title whole rather than cutting a character in half", () => {
    const built = embeds.build({ title: `${"a".repeat(255)}😀` })

    // The emoji is two code units, so it does not fit: what is left is the
    // text before it, and not half an emoji.
    expect(built.title).toBe("a".repeat(255))
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
