import { catalogue } from "@bot-inventor/nodes"
import { literalText } from "@bot-inventor/schema"
import {
  echoParameterProject,
  embedReplyProject,
  helloProject,
  unreachableNodeProject
} from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"
import {
  addNode,
  canRemoveFlow,
  connectWire,
  createFlow,
  disconnectWire,
  insertSlot,
  moveNode,
  removeFlow,
  removeNode,
  renameFlow,
  setNodeField,
  updateFlow
} from "@/project/edits"

function flowOf(project = helloProject()) {
  const flow = project.flows[0]
  if (flow === undefined) throw new Error("the fixture has no Flow")
  return flow
}

function requireDefinition(id: string) {
  const definition = catalogue.get(id)
  if (definition === undefined) throw new Error(`the catalogue has no Node "${id}"`)
  return definition
}

/** `helloProject` with a second, empty Flow, so a name can already be taken. */
function twoFlowProject() {
  const project = helloProject()
  return {
    ...project,
    flows: [...project.flows, { id: "flow-goodbye", name: "Goodbye", nodes: [], wires: [] }]
  }
}

describe("naming a Flow", () => {
  it("takes the name the user typed, leaving the other Flows alone", () => {
    const project = twoFlowProject()
    const rename = renameFlow(project, "flow-hello", "  Welcome  ")

    if (!rename.renamed) throw new Error("the rename was refused")
    expect(rename.project.flows.map(flow => flow.name)).toEqual(["Welcome", "Goodbye"])
    expect(project.flows.map(flow => flow.name)).toEqual(["Hello", "Goodbye"])
  })

  it("refuses a name another Flow of the same Project already has", () => {
    const project = twoFlowProject()

    expect(renameFlow(project, "flow-hello", "Goodbye")).toEqual({
      renamed: false,
      refusal: "duplicate"
    })
    expect(renameFlow(project, "flow-hello", "  Goodbye  ")).toEqual({
      renamed: false,
      refusal: "duplicate"
    })
  })

  it("lets a Flow keep the name it already has", () => {
    const rename = renameFlow(twoFlowProject(), "flow-hello", "Hello")

    if (!rename.renamed) throw new Error("the rename was refused")
    expect(rename.project.flows.map(flow => flow.name)).toEqual(["Hello", "Goodbye"])
  })

  it("refuses a blank name", () => {
    const project = twoFlowProject()

    expect(renameFlow(project, "flow-hello", "")).toEqual({ renamed: false, refusal: "empty" })
    expect(renameFlow(project, "flow-hello", "   ")).toEqual({ renamed: false, refusal: "empty" })
  })
})

describe("creating a Flow", () => {
  it("adds an empty Flow at the end, leaving the ones the Project had", () => {
    const project = twoFlowProject()
    const created = createFlow(project, "flow-new", "Main")

    expect(created.flows).toHaveLength(3)
    expect(created.flows.slice(0, 2)).toEqual(project.flows)
    expect(created.flows.at(-1)).toEqual({ id: "flow-new", name: "Main", nodes: [], wires: [] })
    expect(project.flows).toHaveLength(2)
  })

  it("numbers the default name to the first value no Flow is called", () => {
    const first = createFlow(twoFlowProject(), "flow-1", "Main")
    const second = createFlow(first, "flow-2", "Main")
    const third = createFlow(second, "flow-3", "Main")

    expect(third.flows.map(flow => flow.name)).toEqual([
      "Hello",
      "Goodbye",
      "Main",
      "Main 2",
      "Main 3"
    ])
  })

  it("steps over a numbered name the user has taken for themselves", () => {
    const project = {
      ...twoFlowProject(),
      flows: [
        { id: "flow-main", name: "Main", nodes: [], wires: [] },
        { id: "flow-second", name: "Main 2", nodes: [], wires: [] }
      ]
    }

    expect(createFlow(project, "flow-new", "Main").flows.at(-1)?.name).toBe("Main 3")
  })
})

describe("removing a Flow", () => {
  /** `twoFlowProject` with a third Flow, so a middle one has both neighbours. */
  function threeFlowProject() {
    const project = twoFlowProject()
    return {
      ...project,
      flows: [...project.flows, { id: "flow-third", name: "Third", nodes: [], wires: [] }]
    }
  }

  it("takes the Flow out, leaving the ones the Project had", () => {
    const project = threeFlowProject()
    const removal = removeFlow(project, "flow-goodbye", "flow-hello")

    if (!removal.removed) throw new Error("the removal was refused")
    expect(removal.project.flows.map(flow => flow.id)).toEqual(["flow-hello", "flow-third"])
    expect(project.flows).toHaveLength(3)
  })

  it("refuses to remove the only Flow of a Project", () => {
    const project = helloProject()

    expect(removeFlow(project, "flow-hello", "flow-hello")).toEqual({
      removed: false,
      refusal: "last"
    })
  })

  it("says a Flow the Project does not have is missing, not the last one", () => {
    expect(removeFlow(threeFlowProject(), "flow-nothing", "flow-hello")).toEqual({
      removed: false,
      refusal: "missing"
    })
    expect(removeFlow(helloProject(), "flow-nothing", "flow-hello")).toEqual({
      removed: false,
      refusal: "missing"
    })
  })

  it("says up front which Projects can spare a Flow", () => {
    expect(canRemoveFlow(helloProject())).toBe(false)
    expect(canRemoveFlow(twoFlowProject())).toBe(true)
  })

  it("leaves the open Flow where it was when another Flow goes", () => {
    const removal = removeFlow(threeFlowProject(), "flow-third", "flow-hello")

    if (!removal.removed) throw new Error("the removal was refused")
    expect(removal.open).toBe("flow-hello")
  })

  it("opens the Flow before the one the user was looking at", () => {
    const removal = removeFlow(threeFlowProject(), "flow-third", "flow-third")

    if (!removal.removed) throw new Error("the removal was refused")
    expect(removal.open).toBe("flow-goodbye")
  })

  it("opens the Flow after the one the user was looking at when it was the first", () => {
    const removal = removeFlow(threeFlowProject(), "flow-hello", "flow-hello")

    if (!removal.removed) throw new Error("the removal was refused")
    expect(removal.open).toBe("flow-goodbye")
  })
})

describe("putting a Node on the Canvas", () => {
  const definition = requireDefinition("discord.interaction.reply")

  it("places the Node where the user asked for it", () => {
    const flow = flowOf()
    const added = addNode(flow, definition, { x: 120, y: 240 })
    const node = added.nodes.at(-1)

    expect(node?.type).toBe("discord.interaction.reply")
    expect(node?.position).toEqual({ x: 120, y: 240 })
    // The Flow it was added to is left as it was: the editor renders from the
    // Project, so an edit in place is an edit the screen does not show.
    expect(flow.nodes).toHaveLength(2)
  })

  it("keeps the Nodes and the Wires the Flow already had", () => {
    const flow = flowOf()
    const added = addNode(flow, definition, { x: 0, y: 0 })

    expect(added.nodes.slice(0, 2)).toEqual(flow.nodes)
    expect(added.wires).toEqual(flow.wires)
  })

  it("starts the Node's fields at the defaults its definition declares", () => {
    const added = addNode(flowOf(), definition, { x: 0, y: 0 })

    expect(added.nodes.at(-1)?.fields).toEqual({ content: [], ephemeral: false })
  })

  it("hands out an id that is counted rather than random", () => {
    const once = addNode(flowOf(), definition, { x: 0, y: 0 })
    const twice = addNode(once, definition, { x: 0, y: 0 })

    expect(once.nodes.at(-1)?.id).toBe("node-1")
    expect(twice.nodes.at(-1)?.id).toBe("node-2")
  })

  it("steps over an id the Flow is already using", () => {
    const flow = flowOf()
    flow.nodes.push({ id: "node-1", type: definition.id, position: { x: 0, y: 0 }, fields: {} })

    expect(addNode(flow, definition, { x: 0, y: 0 }).nodes.at(-1)?.id).toBe("node-2")
  })

  it("gives each Node its own copy of a field's default", () => {
    const trigger = requireDefinition("discord.trigger.slashCommand")
    const once = addNode(flowOf(), trigger, { x: 0, y: 0 })
    const twice = addNode(once, trigger, { x: 0, y: 0 })

    const first = once.nodes.at(-1)
    if (!Array.isArray(first?.fields.parameters)) throw new Error("the Trigger has no parameters")
    first.fields.parameters.push({ name: "who", description: "", type: "text", required: true })

    expect(twice.nodes.at(-1)?.fields.parameters).toEqual([])
  })
})

describe("taking a Node off the Canvas", () => {
  it("removes the Node the user asked for", () => {
    const flow = flowOf()
    const removed = removeNode(flow, "node-reply")

    expect(removed.nodes.map(node => node.id)).toEqual(["node-trigger"])
    // The Flow it was removed from is left as it was: the editor renders from
    // the Project, so an edit in place is an edit the screen does not show.
    expect(flow.nodes).toHaveLength(2)
  })

  it("takes every Wire with an end on it", () => {
    const removed = removeNode(flowOf(echoParameterProject()), "node-reply")

    // Both Wires arrive at the Reply Node, and a Wire pointing at a Node that
    // is gone is a Project the Compiler refuses.
    expect(removed.wires).toEqual([])
  })

  it("takes the Wires that leave it as well as the ones that arrive", () => {
    const removed = removeNode(flowOf(echoParameterProject()), "node-trigger")

    expect(removed.wires).toEqual([])
  })

  it("leaves every other Node and Wire alone", () => {
    const flow = flowOf(unreachableNodeProject())
    const removed = removeNode(flow, "node-orphan")

    expect(removed.nodes.map(node => node.id)).toEqual(["node-trigger", "node-reply"])
    expect(removed.wires).toEqual(flow.wires)
  })

  it("removes a Trigger like any other Node", () => {
    // Refusing would trap the user with the Trigger they picked first.
    const removed = removeNode(flowOf(), "node-trigger")

    expect(removed.nodes.map(node => node.id)).toEqual(["node-reply"])
  })

  it("changes nothing when the Node is not there", () => {
    const flow = flowOf()
    const removed = removeNode(flow, "node-missing")

    expect(removed.nodes).toEqual(flow.nodes)
    expect(removed.wires).toEqual(flow.wires)
  })
})

describe("editing a Project from the Canvas", () => {
  it("moves a Node without touching the others", () => {
    const flow = flowOf()
    const moved = moveNode(flow, "node-reply", { x: 10, y: 20 })

    expect(moved.nodes.find(node => node.id === "node-reply")?.position).toEqual({ x: 10, y: 20 })
    expect(moved.nodes.find(node => node.id === "node-trigger")?.position).toEqual({ x: 0, y: 0 })
    expect(flow.nodes.find(node => node.id === "node-reply")?.position).toEqual({ x: 320, y: 0 })
  })

  it("records what the user typed into a field", () => {
    const edited = setNodeField(flowOf(), catalogue, "node-trigger", "name", "goodbye")

    expect(edited.nodes.find(node => node.id === "node-trigger")?.fields.name).toBe("goodbye")
  })

  it("keeps the Wires that a field edit leaves alone", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-trigger",
      "description",
      "Says it back"
    )

    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution", "wire-data"])
  })

  it("takes away the Wire drawn from a parameter the user renamed", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-trigger",
      "parameters",
      [{ name: "text", description: "What to say", type: "text", required: true }]
    )

    // The Execution Wire is untouched: only the Port that went with the old
    // name took its Wire with it.
    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution"])
  })

  it("takes away the Wire feeding a Slot the user typed over", () => {
    // `echoParameterProject`'s reply is one Slot, fed by the command's
    // parameter. Typing plain text over it removes the last occurrence of that
    // Slot, and the Port and the Wire go with it.
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-reply",
      "content",
      literalText("Hello everyone")
    )

    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution"])
  })

  it("keeps the Wire feeding a Slot the user typed around", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-reply",
      "content",
      [
        { kind: "literal", text: "Hello " },
        { kind: "slot", slot: "slot-message" }
      ]
    )

    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution", "wire-data"])
  })

  it("leaves a Wire dangling for a reason of its own where it is", () => {
    const flow = flowOf(echoParameterProject())
    flow.nodes.push({
      id: "node-second",
      type: "discord.interaction.reply",
      position: { x: 640, y: 0 },
      fields: {}
    })
    flow.wires.push({
      id: "wire-elsewhere",
      kind: "data",
      from: { node: "node-reply", port: "gone" },
      to: { node: "node-second", port: "content" }
    })

    // Typing into a Node's name must not quietly destroy Wires that edit had
    // nothing to do with: there is no undo, and nothing says it happened.
    const edited = setNodeField(flow, catalogue, "node-trigger", "name", "say")

    expect(edited.wires.map(wire => wire.id)).toContain("wire-elsewhere")
  })

  it("takes away the Wire drawn from a parameter the user removed", () => {
    const edited = setNodeField(
      flowOf(echoParameterProject()),
      catalogue,
      "node-trigger",
      "parameters",
      []
    )

    expect(edited.wires.map(wire => wire.id)).toEqual(["wire-execution"])
  })

  it("draws a Wire under an id no other Wire has", () => {
    const connected = connectWire(flowOf(), {
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-reply", port: "content" }
    })

    const ids = connected.wires.map(wire => wire.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(connected.wires.at(-1)).toMatchObject({ kind: "data" })
  })

  it("removes only the Wire that was disconnected", () => {
    const flow = flowOf()
    expect(disconnectWire(flow, "wire-execution").wires).toEqual([])
    expect(disconnectWire(flow, "wire-nothing").wires).toHaveLength(1)
  })

  it("replaces one Flow of the Project and leaves the rest alone", () => {
    const project = helloProject()
    project.flows.push({ id: "flow-other", name: "Other", nodes: [], wires: [] })

    const edited = updateFlow(project, "flow-hello", flow =>
      setNodeField(flow, catalogue, "node-trigger", "name", "goodbye")
    )

    expect(edited.flows[0]?.nodes[0]?.fields.name).toBe("goodbye")
    expect(edited.flows[1]).toBe(project.flows[1])
  })
})

describe("dropping a Wire onto a text field", () => {
  it("puts a Slot at the caret and draws the Wire to it in one edit", () => {
    const insertion = insertSlot(
      flowOf(),
      catalogue,
      { node: "node-reply", field: "content", caret: { literal: 0, offset: 5 } },
      { node: "node-trigger", port: "user" },
      "slot-who"
    )

    if (!insertion.inserted) throw new Error(insertion.reasonKey)
    const reply = insertion.flow.nodes.find(node => node.id === "node-reply")

    // `helloProject` replies "Hello!", and the caret was between the word and
    // the exclamation mark, so the text splits around the pill.
    expect(reply?.fields.content).toEqual([
      { kind: "literal", text: "Hello" },
      { kind: "slot", slot: "slot-who" },
      { kind: "literal", text: "!" }
    ])
    expect(insertion.flow.wires.at(-1)).toEqual({
      id: "wire-2",
      kind: "data",
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-reply", port: "slot.slot-who" }
    })
  })

  it("puts a Slot inside the value of an Embed Field, and draws the Wire to it", () => {
    const project = embedReplyProject()
    const flow = flowOf(project)
    const embed = flow.nodes.find(node => node.id === "node-embed")
    if (embed === undefined) throw new Error("the fixture has no Embed Node")
    embed.fields = {
      ...embed.fields,
      embedFields: [{ name: literalText("Asked by"), value: [], inline: false }]
    }

    const insertion = insertSlot(
      flow,
      catalogue,
      {
        node: "node-embed",
        field: "embedFields.0.value",
        caret: { literal: 0, offset: 0 }
      },
      { node: "node-trigger", port: "user" },
      "slot-who"
    )

    if (!insertion.inserted) throw new Error(insertion.reasonKey)
    const edited = insertion.flow.nodes.find(node => node.id === "node-embed")

    expect(edited?.fields.embedFields).toEqual([
      { name: literalText("Asked by"), value: [{ kind: "slot", slot: "slot-who" }], inline: false }
    ])
    expect(insertion.flow.wires.at(-1)).toMatchObject({
      from: { node: "node-trigger", port: "user" },
      to: { node: "node-embed", port: "slot.slot-who" }
    })
  })

  it("coerces the value the Wire carries, as the Coercion table says", () => {
    const insertion = insertSlot(
      flowOf(),
      catalogue,
      { node: "node-reply", field: "content", caret: { literal: 0, offset: 0 } },
      { node: "node-trigger", port: "user" },
      "slot-who"
    )

    if (!insertion.inserted) throw new Error(insertion.reasonKey)
    expect(insertion.flow.wires.at(-1)?.kind).toBe("data")
  })

  it("refuses a value that cannot be read as text, and changes nothing", () => {
    const flow = flowOf()
    const withEmbed = addNode(flow, requireDefinition("discord.embed.build"), { x: 0, y: 0 })

    const insertion = insertSlot(
      withEmbed,
      catalogue,
      { node: "node-reply", field: "content", caret: { literal: 0, offset: 0 } },
      { node: "node-1", port: "embed" },
      "slot-embed"
    )

    expect(insertion).toEqual({ inserted: false, reasonKey: "connections.rejected.dataType" })
  })

  it("refuses an Execution Port dropped on a text field", () => {
    const insertion = insertSlot(
      flowOf(),
      catalogue,
      { node: "node-reply", field: "content", caret: { literal: 0, offset: 0 } },
      { node: "node-trigger", port: "next" },
      "slot-who"
    )

    expect(insertion).toEqual({ inserted: false, reasonKey: "connections.rejected.kind" })
  })

  it("refuses a Node that is not there", () => {
    const insertion = insertSlot(
      flowOf(),
      catalogue,
      { node: "node-nothing", field: "content", caret: { literal: 0, offset: 0 } },
      { node: "node-trigger", port: "user" },
      "slot-who"
    )

    expect(insertion).toEqual({ inserted: false, reasonKey: "connections.rejected.unknownPort" })
  })

  it("uses a Slot again without drawing a second Wire", () => {
    const first = insertSlot(
      flowOf(),
      catalogue,
      { node: "node-reply", field: "content", caret: { literal: 0, offset: 0 } },
      { node: "node-trigger", port: "user" },
      "slot-who"
    )
    if (!first.inserted) throw new Error(first.reasonKey)

    // Using it again is a field edit and nothing else: the Port is already
    // there, and so is the Wire feeding it.
    const again = setNodeField(first.flow, catalogue, "node-reply", "content", [
      { kind: "slot", slot: "slot-who" },
      { kind: "literal", text: " and " },
      { kind: "slot", slot: "slot-who" }
    ])

    expect(again.wires.filter(wire => wire.kind === "data")).toHaveLength(1)
  })
})
