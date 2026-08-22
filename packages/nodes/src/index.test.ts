import { describe, expect, it } from "bun:test"

import { buildCatalogue, catalogue } from "./catalogue.js"
import { applyCoercion, coercions, findCoercion } from "./coercions.js"
import {
  defaultFieldValue,
  findField,
  findPort,
  indent,
  joinStatements,
  portsOf
} from "./definition.js"
import { embed } from "./discord/embed.js"
import { reply } from "./discord/reply.js"
import { slashCommandTrigger } from "./discord/slash-command-trigger.js"
import { isSlotted } from "./slots.js"

describe("the Node catalogue", () => {
  it("offers the slash command Trigger and the Reply Node under their stable ids", () => {
    expect([...catalogue.keys()]).toEqual([
      "discord.trigger.slashCommand",
      "discord.embed.build",
      "discord.interaction.reply"
    ])
  })

  it("refuses two Nodes claiming the same id", () => {
    expect(() => buildCatalogue([reply, reply])).toThrowError(/discord\.interaction\.reply/)
  })

  it("gives every Node a code generator alongside its declaration", () => {
    for (const definition of catalogue.values()) {
      expect(typeof definition.generate).toBe("function")
      expect(definition.labelKey.length).toBeGreaterThan(0)
    }
  })
})

describe("the slash command Trigger", () => {
  it("starts a run and has no Execution input", () => {
    expect(slashCommandTrigger.isTrigger).toBe(true)
    expect(
      slashCommandTrigger.ports.filter(
        port => port.kind === "execution" && port.direction === "input"
      )
    ).toEqual([])
  })

  it("hands out a fresh copy of a field's default, not the catalogue's own", () => {
    const field = findField(slashCommandTrigger, "parameters")
    if (field === undefined) throw new Error("the Trigger has no parameters field")

    const value = defaultFieldValue(field)
    expect(value).toEqual([])
    ;(value as unknown[]).push({ name: "who" })

    expect(defaultFieldValue(field)).toEqual([])
  })

  it("offers the caller as a Data output", () => {
    expect(findPort(slashCommandTrigger, "user")).toMatchObject({
      kind: "data",
      direction: "output",
      dataType: "user"
    })
  })
})

describe("the Ports a slash command's parameters declare", () => {
  const parameters = [
    { name: "message", description: "What to say", type: "text", required: true },
    { name: "times", description: "How many times", type: "number", required: false },
    { name: "loudly", description: "Shout it", type: "boolean", required: false },
    { name: "who", description: "Who to tell", type: "user", required: false }
  ]

  it("has one Data output Port per parameter, carrying that parameter's type", () => {
    const ports = portsOf(slashCommandTrigger, { parameters })

    expect(
      ports
        .filter(port => port.kind === "data" && port.id.startsWith("parameter."))
        .map(port => [port.id, port.kind === "data" ? port.dataType : undefined])
    ).toEqual([
      ["parameter.message", "text"],
      ["parameter.times", "number"],
      ["parameter.loudly", "boolean"],
      ["parameter.who", "user"]
    ])
  })

  it("names a parameter's Port with what the user called it, not a translation key", () => {
    expect(findPort(slashCommandTrigger, "parameter.message", { parameters })).toMatchObject({
      label: "message"
    })
  })

  it("keeps the Trigger's own Ports alongside them", () => {
    const ports = portsOf(slashCommandTrigger, { parameters })

    expect(ports.map(port => port.id).slice(0, 2)).toEqual(["next", "user"])
  })

  it("has no parameter Ports at all when the command asks for nothing", () => {
    expect(portsOf(slashCommandTrigger, {})).toEqual(slashCommandTrigger.ports)
    expect(portsOf(slashCommandTrigger, { parameters: [] })).toEqual(slashCommandTrigger.ports)
  })

  it("takes a Port away when the parameter it came from is renamed", () => {
    const renamed = [{ name: "text", description: "What to say", type: "text", required: true }]

    expect(
      findPort(slashCommandTrigger, "parameter.message", { parameters: renamed })
    ).toBeUndefined()
    expect(findPort(slashCommandTrigger, "parameter.text", { parameters: renamed })).toBeDefined()
  })

  it("ignores entries a hand-edited Project could hold that are not parameters", () => {
    const ports = portsOf(slashCommandTrigger, {
      parameters: [
        "nonsense",
        { name: "", description: "", type: "text", required: true },
        { name: "colour", description: "", type: "rainbow", required: true },
        { name: "message", description: "What to say", type: "text", required: true },
        { name: "message", description: "declared twice", type: "number", required: true }
      ]
    })

    expect(ports.filter(port => port.id.startsWith("parameter.")).map(port => port.id)).toEqual([
      "parameter.message"
    ])
  })
})

describe("the Reply Node", () => {
  it("holds its message in a Slotted text field, and no Data input beside it", () => {
    expect(findField(reply, "content")).toMatchObject({ control: "slottedText" })
    // The old rule — an inline field unless a Wire is connected — is gone: a
    // value reaches the message through a Slot and nowhere else (ADR 0010).
    expect(findPort(reply, "content")).toBeUndefined()
  })

  it("declares one Data input Port per Slot typed into its message", () => {
    const ports = portsOf(reply, {
      content: [
        { kind: "literal", text: "Hello " },
        { kind: "slot", slot: "caller" },
        { kind: "literal", text: ", hello " },
        { kind: "slot", slot: "caller" }
      ]
    })

    expect(ports.filter(port => port.id.startsWith("slot."))).toEqual([
      {
        id: "slot.caller",
        kind: "data",
        direction: "input",
        dataType: "text",
        labelKey: "ports.slot.label"
      }
    ])
  })

  it("has no Slot Port while its message is nothing but text", () => {
    const ports = portsOf(reply, { content: [{ kind: "literal", text: "Hello!" }] })

    expect(ports.some(port => port.id.startsWith("slot."))).toBe(false)
  })

  it("carries on to a next Execution Port", () => {
    expect(findPort(reply, "next")).toMatchObject({ kind: "execution", direction: "output" })
  })

  it("takes an Embed on a Data input Port with no field behind it", () => {
    expect(findPort(reply, "embed")).toMatchObject({
      kind: "data",
      direction: "input",
      dataType: "embed"
    })
    // An Embed is built by a Node; there is nothing about one a user could type
    // into the Reply, so the Port is the only way in.
    expect(findField(reply, "embed")).toBeUndefined()
  })
})

describe("the Embed Node", () => {
  it("hands its Embed out on a Data output Port", () => {
    expect(findPort(embed, "embed")).toMatchObject({
      kind: "data",
      direction: "output",
      dataType: "embed"
    })
  })

  it("runs in the Flow like any other Node, so a run reaches it", () => {
    expect(embed.isTrigger).toBe(false)
    expect(findPort(embed, "in")).toMatchObject({ kind: "execution", direction: "input" })
    expect(findPort(embed, "next")).toMatchObject({ kind: "execution", direction: "output" })
  })

  it("holds every text part as a Slotted field, so a value can go inside any of them", () => {
    const text = [
      "title",
      "url",
      "description",
      "authorName",
      "authorUrl",
      "authorIcon",
      "image",
      "thumbnail",
      "footerText",
      "footerIcon"
    ]

    for (const id of text) {
      const field = findField(embed, id)
      expect(field, `the Embed has no ${id} field`).toBeDefined()
      expect(field && isSlotted(field.control), `${id} is not Slotted`).toBe(true)
    }

    expect(
      portsOf(embed, { footerText: [{ kind: "slot", slot: "who" }] }).map(port => port.id)
    ).toContain("slot.who")
  })

  it("gives a Slot inside one of its Embed Fields a Port, as its own text does", () => {
    const ports = portsOf(embed, {
      embedFields: [
        {
          name: [{ kind: "literal", text: "Asked by" }],
          value: [{ kind: "slot", slot: "caller" }],
          inline: false
        }
      ]
    }).map(port => port.id)

    expect(ports).toContain("slot.caller")
  })

  it("writes its description over several lines, and nothing else", () => {
    expect(findField(embed, "description")).toMatchObject({ control: "slottedParagraph" })
    expect(findField(embed, "title")).toMatchObject({ control: "slottedText" })
  })

  it("stamps the time it was sent with a switch, never with a date", () => {
    expect(findField(embed, "timestamp")).toMatchObject({ control: "switch", defaultValue: false })
  })

  it("stores its colour as the number Discord takes, edited with a colour control", () => {
    const colour = findField(embed, "colour")

    expect(colour).toMatchObject({ control: "colour" })
    expect(typeof colour?.defaultValue).toBe("number")
  })
})

describe("the Coercion table", () => {
  it("has User to Text as its first entry", () => {
    expect(coercions[0]).toMatchObject({ from: "user", to: "text" })
  })

  it("names the Runtime call the Compiler emits for it", () => {
    const coercion = findCoercion("user", "text")
    expect(coercion).toBeDefined()
    expect(coercion && applyCoercion("caller", coercion, "runtime")).toBe(
      "runtime.coerce.userToText(caller)"
    )
  })

  it("gives every entry a label, because a Coercion is drawn on the Wire", () => {
    for (const coercion of coercions) {
      expect(coercion.labelKey.length).toBeGreaterThan(0)
    }
  })

  it("takes a Number and a Boolean into Text, which is what a message is made of", () => {
    expect(findCoercion("number", "text")).toMatchObject({ runtimeCall: "numberToText" })
    expect(findCoercion("boolean", "text")).toMatchObject({ runtimeCall: "booleanToText" })
  })

  it("has none between types that must not be connected", () => {
    expect(findCoercion("text", "user")).toBeUndefined()
    // Text into a Number would have to decide what a word converts to, and
    // there is no answer to that a user would predict.
    expect(findCoercion("text", "number")).toBeUndefined()
    expect(findCoercion("number", "boolean")).toBeUndefined()
    // An Embed is a rich block Discord draws, never a line of text: there is
    // nothing to turn one into, in either direction.
    expect(findCoercion("embed", "text")).toBeUndefined()
    expect(findCoercion("text", "embed")).toBeUndefined()
  })
})

describe("code generation helpers", () => {
  it("indents without touching blank lines", () => {
    expect(indent("a\n\nb")).toBe("  a\n\n  b")
  })

  it("drops the statements a mode chose not to emit", () => {
    expect(joinStatements(["a", "", "b"])).toBe("a\nb")
  })
})
