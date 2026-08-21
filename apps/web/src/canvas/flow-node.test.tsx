// @vitest-environment jsdom

import { catalogue, type NodeDefinition } from "@bot-inventor/nodes"
import { type FieldValue, literalText } from "@bot-inventor/schema"
import { fireEvent, render, within } from "@testing-library/react"
import { ReactFlowProvider } from "@xyflow/react"
import type { ComponentProps } from "react"
import { describe, expect, it } from "vitest"

import { FlowNode, type FlowNodeData } from "@/canvas/flow-node"
import type { NodeRunState } from "@/session/trace"

/**
 * What a Node looks like while the bot is running.
 *
 * The reducer's tests prove which state a Node is in; this proves the Canvas
 * actually shows it, which is the whole feature: someone who cannot program
 * watching their bot think.
 */

const definition = requireDefinition("discord.interaction.reply")

function requireDefinition(id: string): NodeDefinition {
  const found = catalogue.get(id)
  if (found === undefined) throw new Error(`the catalogue has no "${id}"`)
  return found
}

function draw(runState: NodeRunState | undefined) {
  const data: FlowNodeData = {
    node: {
      id: "node-reply",
      type: definition.id,
      position: { x: 0, y: 0 },
      fields: { content: literalText("Hello!") }
    },
    definition,
    runState,
    setField: () => {},
    slotLabel: () => "",
    slotIsWired: () => false,
    remove: () => {}
  }

  // React Flow hands a Node far more than it reads, and building the rest of
  // that by hand would be a test of React Flow rather than of the highlight.
  const props = { data, id: "reply", type: "flowNode" } as unknown as ComponentProps<
    typeof FlowNode
  >

  const { container } = render(
    <ReactFlowProvider>
      <FlowNode {...props} />
    </ReactFlowProvider>
  )

  return within(container).getByTestId("node-reply")
}

describe("drawing the Ports a Node's own fields declare", () => {
  const trigger = requireDefinition("discord.trigger.slashCommand")

  function drawTrigger(parameters: unknown) {
    const data: FlowNodeData = {
      node: {
        id: "node-trigger",
        type: trigger.id,
        position: { x: 0, y: 0 },
        fields: { name: "echo", parameters } as FlowNodeData["node"]["fields"]
      },
      definition: trigger,
      runState: undefined,
      setField: () => {},
      slotLabel: () => "",
      slotIsWired: () => false,
      remove: () => {}
    }
    const props = { data, id: "trigger", type: "flowNode" } as unknown as ComponentProps<
      typeof FlowNode
    >

    const { container } = render(
      <ReactFlowProvider>
        <FlowNode {...props} />
      </ReactFlowProvider>
    )
    return within(container).getByTestId("node-trigger")
  }

  it("gives a declared parameter a Port, named the way the user named it", () => {
    const node = drawTrigger([
      { name: "message", description: "What to say", type: "text", required: true }
    ])

    expect(within(node).getByTestId("port-trigger-parameter.message")).toBeDefined()
    expect(node.textContent).toContain("message")
  })

  it("draws no parameter Ports for a command that asks for nothing", () => {
    const node = drawTrigger([])

    expect(within(node).queryByTestId("port-trigger-parameter.message")).toBeNull()
  })
})

describe("drawing a Node the run reached", () => {
  it("marks the Node the bot is inside right now", () => {
    const node = draw("entered")

    expect(node.dataset.runState).toBe("entered")
    expect(node.className).toContain("ring-amber-500")
  })

  it("marks the Node the run got through", () => {
    expect(draw("completed").className).toContain("ring-emerald-500")
  })

  it("marks the Node a run stopped at, so a failure is findable at a glance", () => {
    expect(draw("failed").className).toContain("ring-destructive")
  })

  it("leaves a Node no run has reached as it was", () => {
    const node = draw(undefined)

    expect(node.dataset.runState).toBeUndefined()
    expect(node.className).not.toContain("ring-")
  })
})

describe("a Slotted text field on a Node", () => {
  function drawReply(
    content: FieldValue,
    setField: (id: string, value: FieldValue) => void = () => {}
  ) {
    const data: FlowNodeData = {
      node: {
        id: "node-reply",
        type: definition.id,
        position: { x: 0, y: 0 },
        fields: { content }
      },
      definition,
      runState: undefined,
      setField,
      slotLabel: slot => `from ${slot}`,
      slotIsWired: () => false,
      remove: () => {}
    }
    const props = { data, id: "reply", type: "flowNode" } as unknown as ComponentProps<
      typeof FlowNode
    >

    const { container } = render(
      <ReactFlowProvider>
        <FlowNode {...props} />
      </ReactFlowProvider>
    )
    return container
  }

  /** The first text box of the message field, which is the whole of it until a pill lands. */
  function messageBox(container: HTMLElement): HTMLInputElement {
    const box = container.querySelector<HTMLInputElement>("#reply-content")
    if (box === null) throw new Error("the Reply Node drew no text box for its message")
    return box
  }

  it("shows the text of the field in a text box", () => {
    expect(messageBox(drawReply(literalText("Hello!"))).value).toBe("Hello!")
  })

  it("writes what was typed back as one literal segment", () => {
    const written: FieldValue[] = []
    const container = drawReply(literalText("Hello!"), (_id, value) => written.push(value))

    fireEvent.change(messageBox(container), { target: { value: "Goodbye!" } })

    expect(written).toEqual([literalText("Goodbye!")])
  })

  it("draws the Slot the message holds as a pill inside the text", () => {
    const container = drawReply([
      { kind: "literal", text: "Hello, " },
      { kind: "slot", slot: "caller" }
    ])

    expect(within(container).getByTestId("slot-reply-content-0").textContent).toContain(
      "from caller"
    )
  })

  it("draws a Port for the Slot the message holds", () => {
    const container = drawReply([{ kind: "slot", slot: "caller" }])

    expect(within(container).getByTestId("port-reply-slot.caller")).toBeDefined()
  })
})

/**
 * A Node with too much typed into it to draw on the Canvas. It is drawn as the
 * bar and the title, and the fields themselves are the Inspector's.
 */
describe("a Node the Canvas only summarises", () => {
  const embedDefinition = requireDefinition("discord.embed.build")

  function drawEmbed(fields: Record<string, FieldValue>) {
    const data: FlowNodeData = {
      node: { id: "node-embed", type: embedDefinition.id, position: { x: 0, y: 0 }, fields },
      definition: embedDefinition,
      runState: undefined,
      setField: () => {},
      slotLabel: () => "Slash command · Who used it",
      slotIsWired: () => false,
      remove: () => {}
    }
    const props = { data, id: "embed", type: "flowNode" } as unknown as ComponentProps<
      typeof FlowNode
    >

    const { container } = render(
      <ReactFlowProvider>
        <FlowNode {...props} />
      </ReactFlowProvider>
    )
    return container
  }

  it("draws the colour it holds as the bar down its side", () => {
    const container = drawEmbed({ title: literalText("Rules"), colour: 5793266 })
    const bar = within(container).getByTestId("node-summary-colour-embed")

    expect(bar.style.backgroundColor).toBe("rgb(88, 101, 242)")
  })

  it("draws the title beside it, with no formatting in it at all", () => {
    const container = drawEmbed({ title: literalText("**Rules**"), colour: 0 })

    expect(within(container).getByTestId("node-summary-embed").textContent).toContain("**Rules**")
  })

  it("says an Embed nobody has titled is untitled rather than blank", () => {
    const container = drawEmbed({ colour: 0 })

    expect(within(container).getByTestId("node-summary-embed").textContent).toContain("No title")
  })

  it("draws a Slot in the title as the pill it is", () => {
    const container = drawEmbed({ title: [{ kind: "slot", slot: "slot-who" }], colour: 0 })

    expect(within(container).getByTestId("preview-slot").textContent).toBe(
      "Slash command · Who used it"
    )
  })

  it("draws none of its fields, because they are typed into the Inspector", () => {
    const container = drawEmbed({ title: literalText("Rules"), colour: 0 })

    expect(within(container).queryByTestId("field-box-embed-title-0")).toBeNull()
  })
})

/**
 * What a Node says is wrong with what was typed into it. The Embed Node is the
 * first that answers, and what it answers is the Runtime's one reading of
 * Discord's limits: the Canvas only draws it.
 */
describe("a Node that says what is wrong with it", () => {
  const embed = requireDefinition("discord.embed.build")

  function drawEmbed(fields: Record<string, FieldValue>) {
    const data: FlowNodeData = {
      node: { id: "node-embed", type: embed.id, position: { x: 0, y: 0 }, fields },
      definition: embed,
      runState: undefined,
      setField: () => {},
      slotLabel: () => "",
      slotIsWired: () => false,
      remove: () => {}
    }
    const props = { data, id: "embed", type: "flowNode" } as unknown as ComponentProps<
      typeof FlowNode
    >

    const { container } = render(
      <ReactFlowProvider>
        <FlowNode {...props} />
      </ReactFlowProvider>
    )
    return container
  }

  it("says an Embed with nothing in it is one Discord refuses", () => {
    const container = drawEmbed({})

    expect(within(container).getByTestId("node-problems-embed").textContent).toContain(
      "nothing in it"
    )
  })

  it("says when the whole Embed is over Discord's total budget", () => {
    const container = drawEmbed({
      description: literalText("a".repeat(4096)),
      footerText: literalText("b".repeat(1905))
    })

    expect(within(container).getByTestId("node-problems-embed").textContent).toContain("6000")
  })

  it("says nothing at all about an Embed Discord accepts", () => {
    const container = drawEmbed({ title: literalText("Server rules") })

    expect(within(container).queryByTestId("node-problems-embed")).toBeNull()
  })
})
