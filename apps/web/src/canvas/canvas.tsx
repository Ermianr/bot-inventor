import {
  addableNodes,
  catalogue,
  checkConnection,
  findCoercion,
  findFlowPort,
  type NodeDefinition,
  slotPortId
} from "@bot-inventor/nodes"
import type { Flow, PortReference, Wire as ProjectWire } from "@bot-inventor/schema"
import {
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type OnConnectEnd,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow
} from "@xyflow/react"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { AddNodeMenu, type ScreenPoint } from "@/canvas/add-node"
import { FlowNode, type FlowNodeData, type FlowNodeType } from "@/canvas/flow-node"
import { Inspector } from "@/canvas/inspector"
import { FlowMinimap } from "@/canvas/minimap"
import { Wire, type WireData, type WireType } from "@/canvas/wire"
import { translate, translateDefinitionKey } from "@/i18n/messages"
import { useMinimap } from "@/preferences/minimap"
import type { Caret } from "@/project/editable-text"
import type { ProjectEditor } from "@/project/use-project"
import type { RunTrace } from "@/session/trace"

import "@xyflow/react/dist/style.css"

/**
 * The Flow, drawn and editable.
 *
 * React Flow calls a Wire an edge and a Port a handle. Those words live in this
 * file and nowhere else: everything the rest of the editor is handed is spelled
 * the way `CONTEXT.md` spells it.
 *
 * While a bot is running, the Canvas is also where the user watches it think:
 * the Tracing of the most recent run marks each Node as it is reached and
 * writes on every Wire what travelled down it.
 *
 * Whether a Wire may be drawn is not decided here. `checkConnection` decides
 * it, from the same Coercion table the Compiler emits from, so a Wire the user
 * is allowed to draw is always one the Compiler accepts.
 */

const nodeTypes = { flowNode: FlowNode }
const wireTypes = { wire: Wire }

/**
 * The zoom and fit-view controls, dressed in the application's tokens. React
 * Flow paints them from its `--xy-controls-*` variables, which its own
 * stylesheet fills with greys belonging to a design system that is not ours;
 * pointing each variable at a token hands them back to the theme, and they then
 * change with it as everything else does.
 */
const controlTokens = {
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-background-color-hover": "var(--accent)",
  "--xy-controls-button-color": "var(--card-foreground)",
  "--xy-controls-button-color-hover": "var(--accent-foreground)",
  "--xy-controls-button-border-color": "var(--border)"
} as CSSProperties

type CanvasProps = { editor: ProjectEditor; trace?: RunTrace }

/**
 * The Canvas needs React Flow's viewport from outside the `ReactFlow` element —
 * turning the point a right-click happened at into a position in the Flow is
 * done next to the menu, not inside the graph — and `useReactFlow` only answers
 * under a provider. So this puts the provider up, and the Canvas itself is
 * everything under it.
 */
export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasUnderProvider {...props} />
    </ReactFlowProvider>
  )
}

function CanvasUnderProvider({ editor, trace }: CanvasProps) {
  // Taken apart rather than read through `editor`: each of these keeps its
  // identity across a render and the object holding them does not, so what the
  // memoized values below depend on is the callback and never its container.
  const {
    flow,
    setNodeField,
    removeNode,
    moveNode,
    disconnectWire,
    connectWire,
    insertSlot,
    addNode
  } = editor
  const { screenToFlowPosition } = useReactFlow()
  const [refusal, setRefusal] = useState<string | undefined>(undefined)

  /**
   * The Node the Inspector is showing, which is the one the user last clicked.
   * A Node that is not on this Flow any more is nobody's selection, so the
   * lookup below is what decides whether the panel is there at all.
   */
  const [selected, setSelected] = useState<string | undefined>(undefined)

  // Whether the whole Flow is drawn in the corner as well. The Canvas reads the
  // preference itself rather than being handed it: the menu that changes it is
  // on the other side of the editor, and neither has anything else to say to
  // the other.
  const minimap = useMinimap()

  /**
   * What the run being watched did in this Flow. A run of another Flow lights
   * nothing up here: the user is looking at one Flow, and a Node of it that did
   * not run must not be drawn as though it had.
   */
  const watching = trace?.flow === flow.id ? trace : undefined

  /**
   * Why the last connection the user tried was refused. React Flow asks whether
   * a connection is valid while the pointer is still down and only tells us it
   * ended afterwards, so the reason has to be kept between the two.
   */
  const lastRefusal = useRef<string | undefined>(undefined)

  const nodes: FlowNodeType[] = flow.nodes.flatMap(node => {
    const definition = catalogue.get(node.type)
    if (definition === undefined) return []

    const data: FlowNodeData = {
      node,
      definition,
      runState: watching?.nodes[node.id],
      setField: (fieldId, value) => setNodeField(node.id, fieldId, value),
      slotLabel: slot => slotLabelOf(flow, node.id, slot),
      slotIsWired: slot => slotWireOf(flow, node.id, slot) !== undefined,
      remove: () => removeNode(node.id)
    }
    return [
      {
        id: node.id,
        type: "flowNode" as const,
        position: node.position,
        data
      }
    ]
  })

  const wires: WireType[] = flow.wires.map(wire => {
    const data: WireData = {
      kind: wire.kind,
      coercionLabelKey: coercionLabelKeyOf(flow, wire),
      carried: watching?.wires[wire.id],
      remove: disconnectWire
    }
    return {
      id: wire.id,
      type: "wire" as const,
      source: wire.from.node,
      sourceHandle: wire.from.port,
      target: wire.to.node,
      targetHandle: wire.to.port,
      data
    }
  })

  /**
   * The Nodes React Flow is drawing. They are the Project's, plus what React
   * Flow measured them to be: it works out how big a Node is once it is on
   * screen, and handing it a freshly built list on every edit would throw that
   * away and leave it unable to drag what it has not measured.
   */
  const [drawn, setDrawn, applyNodeChanges] = useNodesState<FlowNodeType>([])

  useEffect(() => {
    setDrawn(previous =>
      nodes.map(node => {
        const measured = previous.find(candidate => candidate.id === node.id)
        return measured === undefined ? node : { ...measured, ...node }
      })
    )
  }, [nodes, setDrawn])

  /**
   * A Node moved or removed on the Canvas is moved or removed in the Project,
   * however it happened. React Flow's own Backspace takes a Node off the screen
   * and would otherwise leave it in the Project, still compiled and still run;
   * routing it through the same removal takes its Wires with it too.
   */
  const onNodesChange = (changes: NodeChange<FlowNodeType>[]) => {
    applyNodeChanges(changes)
    for (const change of changes) {
      if (change.type === "position" && change.position !== undefined) {
        moveNode(change.id, change.position)
      }
      if (change.type === "remove") removeNode(change.id)
      // The Inspector follows the selection React Flow already keeps, so
      // clicking a Node is the one gesture that opens it.
      if (change.type === "select" && change.selected) setSelected(change.id)
    }
  }

  const isValidConnection: IsValidConnection<WireType> = connection => {
    const ends = endsOf(connection)
    if (ends === undefined) return false

    const check = checkConnection({ flow, catalogue, ...ends })
    lastRefusal.current = check.legal ? undefined : check.reasonKey
    return check.legal
  }

  const onConnect = (connection: Connection) => {
    const ends = endsOf(connection)
    if (ends === undefined) return

    const check = checkConnection({ flow, catalogue, ...ends })
    if (!check.legal) return

    lastRefusal.current = undefined
    setRefusal(undefined)
    connectWire({ kind: check.kind, ...ends })
  }

  /** Removing a Wire is removing it from the Project, however it was removed. */
  const onWiresChange = (changes: EdgeChange<WireType>[]) => {
    for (const change of changes) {
      if (change.type === "remove") disconnectWire(change.id)
    }
  }

  /** A new drag is a new question, so the last answer stops being shown. */
  const onConnectStart = () => {
    lastRefusal.current = undefined
    setRefusal(undefined)
  }

  /**
   * A refused Wire is told to the user in words. React Flow's own answer is to
   * drop the Wire on the floor, which leaves someone who does not know the
   * rules believing the application is broken.
   *
   * Only an outright refusal is worth saying. Letting go over empty Canvas
   * leaves `isValid` null, and that is someone changing their mind, not the
   * editor turning them down.
   */
  const onConnectEnd: OnConnectEnd = (event, state) => {
    const from = state.fromHandle
    const fromPort = from?.id
    const drop = slotDropTarget(event)

    /*
      A Wire let go over a text field is a Slot being dropped into the
      sentence, not a Wire nobody finished. React Flow can only read it as
      landing on nothing — the Port the Wire arrives at does not exist until
      the Slot is in the field — so the gesture is answered here, and the
      Slot and the Wire are made in one edit.
    */
    if (drop !== undefined && from?.type === "source" && typeof fromPort === "string") {
      const insertion = insertSlot(drop, { node: from.nodeId, port: fromPort })
      setRefusal(insertion.inserted ? undefined : insertion.reasonKey)
      lastRefusal.current = undefined
      return
    }

    if (state.isValid !== false) return
    setRefusal(lastRefusal.current)
    lastRefusal.current = undefined
  }

  /**
   * What the catalogue offers this Flow. It is read off the Flow's Nodes, so a
   * Trigger becomes unavailable the moment one is dropped on the Canvas and is
   * offered again the moment it is gone.
   */
  const choices = addableNodes(flow, catalogue)

  /**
   * A Node is added where the pointer was, not where the viewport happens to
   * start: the user is told it lands where they clicked, and a Canvas they have
   * panned or zoomed must keep that promise.
   */
  const placeNode = (definition: NodeDefinition, at: ScreenPoint) => {
    addNode(definition, screenToFlowPosition(at))
  }

  const inspected = inspectedNode(flow, selected)

  return (
    <section aria-label={translate("canvas.label")} className="relative flex h-full w-full">
      {/*
        The Canvas takes whatever the Inspector leaves, and gives it back the
        moment the panel closes: the Flow is what the user is looking at.
      */}
      <div className="relative min-w-0 flex-1">
        <AddNodeMenu choices={choices} landsOnNode={landsOnNode} place={placeNode}>
          <ReactFlow
            edgeTypes={wireTypes}
            edges={wires}
            fitView
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            nodes={drawn}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onConnectStart={onConnectStart}
            onEdgesChange={onWiresChange}
            onNodesChange={onNodesChange}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} style={controlTokens} />
            {minimap.shown && <FlowMinimap />}
          </ReactFlow>
        </AddNodeMenu>
      </div>

      {refusal !== undefined && (
        <p
          className="absolute inset-x-4 bottom-4 rounded-md border bg-background px-3 py-2 text-center text-sm"
          data-testid="connection-refusal"
          role="status"
        >
          {translateDefinitionKey(refusal)}
        </p>
      )}

      {inspected !== undefined && (
        <Inspector
          definition={inspected.definition}
          node={inspected.node}
          setField={(fieldId, value) => setNodeField(inspected.node.id, fieldId, value)}
          slotIsWired={slot => slotWireOf(flow, inspected.node.id, slot) !== undefined}
          slotLabel={slot => slotLabelOf(flow, inspected.node.id, slot)}
          slotValue={slot => slotValueOf(flow, inspected.node.id, slot, watching)}
        />
      )}
    </section>
  )
}

/**
 * The Node the Inspector is open for: the selected one, when it is a Node that
 * is typed into the Inspector rather than on the Canvas.
 */
function inspectedNode(flow: ProjectEditor["flow"], selected: string | undefined) {
  const node = flow.nodes.find(candidate => candidate.id === selected)
  const definition = node === undefined ? undefined : catalogue.get(node.type)
  if (node === undefined || definition?.summary === undefined) return undefined
  return { node, definition }
}

/** A text field a Wire was let go over, and where in it the Slot lands. */
type SlotDrop = { node: string; field: string; caret: Caret }

/**
 * The text box under the point a Wire was let go at, if there is one.
 *
 * It is read from the point rather than from the event's target because the
 * pointer is captured for the length of a connection drag, which leaves the
 * target saying where the drag started rather than where it ended.
 *
 * `data-slot-*` are the Slotted field's own attributes, and this is the other
 * half of that arrangement: the field says which box is which, and this turns
 * a drop into the caret position the Slot goes at.
 */
function slotDropTarget(event: MouseEvent | TouchEvent): SlotDrop | undefined {
  const point = event instanceof MouseEvent ? event : event.changedTouches[0]
  if (point === undefined) return undefined

  const box = document.elementFromPoint(point.clientX, point.clientY)?.closest("[data-slot-field]")
  if (!(box instanceof HTMLTextAreaElement)) return undefined

  const { slotCaret, slotField, slotLiteral, slotNode } = box.dataset
  if (slotField === undefined || slotLiteral === undefined || slotNode === undefined) {
    return undefined
  }

  // Where the caret was left, or the end of what is written there: a value
  // dropped on a field nobody has typed in yet lands after the text rather
  // than in front of it.
  const caret = Number(slotCaret)
  const offset = Number.isFinite(caret) ? caret : box.value.length
  return {
    node: slotNode,
    field: slotField,
    caret: { literal: Number(slotLiteral), offset }
  }
}

/** The Wire feeding one of a Node's Slots, if the user has drawn one. */
function slotWireOf(flow: Flow, nodeId: string, slot: string): ProjectWire | undefined {
  const port = slotPortId(slot)
  return flow.wires.find(wire => wire.to.node === nodeId && wire.to.port === port)
}

/**
 * What the run being watched carried into a Slot, if it carried anything.
 *
 * The Tracing writes what a Wire carried onto the Wire, and a Slot is fed
 * through a Port like every other value, so this is the same lookup the Wire
 * label does — which is what makes the preview show the last Run's values
 * rather than a second story about them.
 */
function slotValueOf(
  flow: Flow,
  nodeId: string,
  slot: string,
  trace: RunTrace | undefined
): string | undefined {
  const wire = slotWireOf(flow, nodeId, slot)
  return wire === undefined ? undefined : trace?.wires[wire.id]
}

/**
 * What a Slot's pill says. A Slot with a Wire is named after where its value
 * comes from — the Node, and what that Node calls the value — so two pills fed
 * by the same Node are still told apart at a glance. A Slot with no Wire is
 * named as the empty hole it is.
 */
function slotLabelOf(flow: Flow, nodeId: string, slot: string): string {
  const wire = slotWireOf(flow, nodeId, slot)
  if (wire === undefined) return translate("canvas.slot.empty")

  const source = flow.nodes.find(node => node.id === wire.from.node)
  const definition = source === undefined ? undefined : catalogue.get(source.type)
  const port = findFlowPort(flow, catalogue, wire.from)
  if (definition === undefined || port === undefined) return translate("canvas.slot.empty")

  return translate("canvas.slot.label", {
    node: translateDefinitionKey(definition.labelKey),
    // A Port the user named is shown in their own words; the rest are translated.
    value: port.label ?? translateDefinitionKey(port.labelKey)
  })
}

/**
 * Whether a pointer gesture landed on a Node. `react-flow__node` is React
 * Flow's own class on the element it wraps a Node in, and this file is where
 * its words are allowed to be spoken.
 */
function landsOnNode(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".react-flow__node") !== null
}

/**
 * The two Ports a React Flow connection names, in our own vocabulary. A
 * connection without handles names no Port at all, and there is nothing to
 * check about it.
 */
function endsOf(connection: Connection | WireType) {
  const { source, sourceHandle, target, targetHandle } = connection
  if (
    sourceHandle === null ||
    sourceHandle === undefined ||
    targetHandle === null ||
    targetHandle === undefined
  ) {
    return undefined
  }
  const ends: { from: PortReference; to: PortReference } = {
    from: { node: source, port: sourceHandle },
    to: { node: target, port: targetHandle }
  }
  return ends
}

/** What a Wire already on the Canvas converts, if anything. */
function coercionLabelKeyOf(flow: ProjectEditor["flow"], wire: ProjectWire): string | undefined {
  if (wire.kind !== "data") return undefined

  const from = findFlowPort(flow, catalogue, wire.from)
  const to = findFlowPort(flow, catalogue, wire.to)
  if (from?.kind !== "data" || to?.kind !== "data") return undefined

  return findCoercion(from.dataType, to.dataType)?.labelKey
}
