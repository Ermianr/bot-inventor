import type { Locator, Page } from "@playwright/test"

import { DashboardPage } from "./dashboard-page"
import { MenuBarPage } from "./menu-bar-page"

/**
 * The Canvas, as a test drives it: Nodes, Ports, Wires and the words the editor
 * says when it refuses one.
 *
 * Dragging a Wire is a pointer gesture rather than a click, so it lives here
 * once instead of in every test that connects something.
 */
export class CanvasPage {
  constructor(private readonly page: Page) {}

  /**
   * Opens the demonstration Project from the Dashboard, which is the only way
   * into a Canvas now that the application owns where Projects live.
   */
  async open() {
    await new DashboardPage(this.page).openExample()
    await this.node("node-trigger").waitFor()
  }

  /**
   * Starts the editor again, which is as close to a restart as a browser gets.
   * It waits for autosave to have caught up first: a reload is only a fair test
   * of what survives once what the user did has been written.
   */
  async reload() {
    await new MenuBarPage(this.page).waitUntilSaved()
    await this.page.reload()
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

  /**
   * The zoom and fit-view controls, which are React Flow's own element: it
   * draws them itself, and `react-flow__controls-button` is the class it puts
   * on each one.
   */
  controlButtons(): Locator {
    return this.page.locator(".react-flow__controls-button")
  }

  /**
   * The Minimap, which React Flow draws itself: `react-flow__minimap` is the
   * class it puts on it, and this file is where its words are allowed to be
   * spoken.
   */
  minimap(): Locator {
    return this.page.locator(".react-flow__minimap")
  }

  /** Every Node as the Minimap draws it, in the order the Flow holds them. */
  minimapNodes(): Locator {
    return this.page.locator(".react-flow__minimap-node")
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

  /** Right-clicks a Node, which is what opens the menu that removes it. */
  async rightClickNode(nodeId: string) {
    await this.node(nodeId).locator("header").click({ button: "right" })
  }

  /** The "Delete this node" entry of a Node's own context menu. */
  removeNode(nodeId: string): Locator {
    return this.page.getByTestId(`node-remove-${nodeId}`)
  }

  /** The catalogue, as the searchable list the user picks a Node from. */
  nodeList(): Locator {
    return this.page.getByTestId("add-node-list")
  }

  /**
   * One group of that list, which is what tells a Trigger from the rest. It is
   * found by a name of ours rather than by its heading: the heading is words the
   * user reads, and they are different words in every language we ship.
   */
  nodeGroup(group: "triggers" | "rest"): Locator {
    return this.page.getByTestId(`add-node-group-${group}`)
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
