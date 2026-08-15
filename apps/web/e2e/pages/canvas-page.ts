import type { Locator, Page } from "@playwright/test"

/**
 * The Canvas, as a test drives it: Nodes, Ports, Wires and the words the editor
 * says when it refuses one.
 *
 * Dragging a Wire is a pointer gesture rather than a click, so it lives here
 * once instead of in every test that connects something.
 */
export class CanvasPage {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/")
    await this.node("node-trigger").waitFor()
  }

  node(nodeId: string): Locator {
    return this.page.getByTestId(`node-${nodeId}`)
  }

  port(nodeId: string, portId: string): Locator {
    return this.page.getByTestId(`port-${nodeId}-${portId}`)
  }

  /** Every Wire currently drawn, found by the control that removes it. */
  wires(): Locator {
    return this.page.locator('[data-testid^="wire-remove-"]')
  }

  wire(wireId: string): Locator {
    return this.page.getByTestId(`wire-${wireId}`)
  }

  /** The Coercion written on a Wire, when it converts what it carries. */
  coercionOn(wireId: string): Locator {
    return this.page.getByTestId(`wire-coercion-${wireId}`)
  }

  removeWire(wireId: string): Locator {
    return this.page.getByTestId(`wire-remove-${wireId}`)
  }

  /** What the editor said about the last Wire it refused. */
  refusal(): Locator {
    return this.page.getByTestId("connection-refusal")
  }

  field(nodeId: string, fieldId: string): Locator {
    return this.page.locator(`#${nodeId}-${fieldId}`)
  }

  /**
   * The empty part of the Canvas, which is React Flow's own element rather than
   * anything of ours: it is what the pointer lands on between the Nodes.
   */
  pane(): Locator {
    return this.page.locator(".react-flow__pane")
  }

  /** Right-clicks empty Canvas at a point measured from the Canvas's top left. */
  async rightClickPane(at: { x: number; y: number }) {
    const box = await this.pane().boundingBox()
    if (box === null) throw new Error("the Canvas is not on screen")

    await this.page.mouse.click(box.x + at.x, box.y + at.y, { button: "right" })
  }

  /** The "Add a node" entry of the Canvas's context menu. */
  addNode(): Locator {
    return this.page.getByTestId("canvas-add-node")
  }

  /** The catalogue, as the searchable list the user picks a Node from. */
  nodeList(): Locator {
    return this.page.getByTestId("add-node-list")
  }

  /** One Node of that list, found by the catalogue id the user never sees. */
  nodeChoice(definitionId: string): Locator {
    return this.page.getByTestId(`add-node-${definitionId}`)
  }

  /** Drags a Wire from one Port to another, the way a user does. */
  async drawWire(from: Locator, to: Locator) {
    const start = await centreOf(from)
    const end = await centreOf(to)

    await this.page.mouse.move(start.x, start.y)
    await this.page.mouse.down()
    // React Flow decides what a drag is pointing at from the moves, so a jump
    // straight to the target reads as no drag at all.
    await this.page.mouse.move(end.x, end.y, { steps: 12 })
    await this.page.mouse.up()
  }

  /** Drags a Node by its header, which is the part that is not a field. */
  async dragNode(nodeId: string, by: { x: number; y: number }) {
    const header = this.node(nodeId).locator("header")
    const start = await centreOf(header)

    await this.page.mouse.move(start.x, start.y)
    await this.page.mouse.down()
    await this.page.mouse.move(start.x + by.x, start.y + by.y, { steps: 12 })
    await this.page.mouse.up()
  }
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error("the element the test is dragging is not on screen")
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
