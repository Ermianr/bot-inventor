import { describe, expect, it } from "vitest"
import { buildCatalogue, catalogue } from "./catalogue.js"
import { applyCoercion, coercions, findCoercion } from "./coercions.js"
import { checkConnection } from "./connections.js"
import { findField, findPort, indent, joinStatements, type PortDefinition } from "./definition.js"
import { reply } from "./discord/reply.js"
import { slashCommandTrigger } from "./discord/slash-command-trigger.js"

describe("the Node catalogue", () => {
  it("offers the slash command Trigger and the Reply Node under their stable ids", () => {
    expect([...catalogue.keys()]).toEqual([
      "discord.trigger.slashCommand",
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

  it("offers the caller as a Data output", () => {
    expect(findPort(slashCommandTrigger, "user")).toMatchObject({
      kind: "data",
      direction: "output",
      dataType: "user"
    })
  })
})

describe("the Reply Node", () => {
  it("takes its text from a Data input Port backed by a field of the same id", () => {
    expect(findPort(reply, "content")).toMatchObject({ kind: "data", direction: "input" })
    expect(findField(reply, "content")).toMatchObject({ control: "text" })
  })

  it("carries on to a next Execution Port", () => {
    expect(findPort(reply, "next")).toMatchObject({ kind: "execution", direction: "output" })
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

  it("has none between types that must not be connected", () => {
    expect(findCoercion("text", "user")).toBeUndefined()
  })
})

describe("checking whether a Wire is legal", () => {
  const callerPort = findPort(slashCommandTrigger, "user")
  const contentPort = findPort(reply, "content")
  const nextPort = findPort(slashCommandTrigger, "next")
  const inPort = findPort(reply, "in")

  function requirePort(port: PortDefinition | undefined): PortDefinition {
    if (port === undefined) throw new Error("the Node does not declare that Port")
    return port
  }

  it("accepts an Execution Wire without coercing anything", () => {
    expect(checkConnection(requirePort(nextPort), requirePort(inPort))).toEqual({
      legal: true,
      coercion: undefined
    })
  })

  it("accepts the User output into a text field, and says it coerces", () => {
    const check = checkConnection(requirePort(callerPort), requirePort(contentPort))

    expect(check).toMatchObject({ legal: true })
    expect(check.legal && check.coercion).toMatchObject({ runtimeCall: "userToText" })
  })

  it("rejects a Wire between an Execution Port and a Data Port", () => {
    expect(checkConnection(requirePort(nextPort), requirePort(contentPort))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.kind"
    })
  })

  it("rejects a Wire between Data types with no Coercion between them", () => {
    const textOutput: PortDefinition = {
      id: "out",
      kind: "data",
      direction: "output",
      dataType: "text",
      labelKey: "ports.out.label"
    }
    const userInput: PortDefinition = {
      id: "target",
      kind: "data",
      direction: "input",
      dataType: "user",
      labelKey: "ports.target.label"
    }

    expect(checkConnection(textOutput, userInput)).toEqual({
      legal: false,
      reasonKey: "connections.rejected.dataType"
    })
  })

  it("rejects a Wire that does not run from an output to an input", () => {
    expect(checkConnection(requirePort(contentPort), requirePort(callerPort))).toEqual({
      legal: false,
      reasonKey: "connections.rejected.direction"
    })
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
