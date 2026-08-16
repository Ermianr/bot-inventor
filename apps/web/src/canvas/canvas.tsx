import {
  addableNodes,
  catalogue,
  checkConnection,
  findCoercion,
  findFlowPort,
  type NodeDefinition
} from "@bot-inventor/nodes"
import type { PortReference, Wire as ProjectWire } from "@bot-inventor/schema"
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
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AddNodeMenu, type ScreenPoint } from "@/canvas/add-node"
import { FlowNode, type FlowNodeData, type FlowNodeType } from "@/canvas/flow-node"
import { Wire, type WireData, type WireType } from "@/canvas/wire"
import { translate, translateDefinitionKey } from "@/i18n/messages"
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
  const { flow } = editor
  const { screenToFlowPosition } = useReactFlow()
  const [refusal, setRefusal] = useState<string | undefined>(undefined)

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

  const nodes = useMemo<FlowNodeType[]>(
    () =>
      flow.nodes.flatMap(node => {
        const definition = catalogue.get(node.type)
        if (definition === undefined) return []

        const data: FlowNodeData = {
          node,
          definition,
          runState: watching?.nodes[node.id],
          setField: (fieldId, value) => editor.setNodeField(node.id, fieldId, value),
          remove: () => editor.removeNode(node.id)
        }
        return [
          {
            id: node.id,
            type: "flowNode" as const,
            position: node.position,
            data
          }
        ]
      }),
    [flow.nodes, editor.setNodeField, editor.removeNode, watching]
  )

  const wires = useMemo<WireType[]>(
    () =>
      flow.wires.map(wire => {
        const data: WireData = {
          kind: wire.kind,
          coercionLabelKey: coercionLabelKeyOf(flow, wire),
          carried: watching?.wires[wire.id],
          remove: editor.disconnectWire
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
      }),
    [flow, editor.disconnectWire, watching]
  )

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
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNodeType>[]) => {
      applyNodeChanges(changes)
      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined) {
          editor.moveNode(change.id, change.position)
        }
        if (change.type === "remove") editor.removeNode(change.id)
      }
    },
    [applyNodeChanges, editor.moveNode, editor.removeNode]
  )

  const isValidConnection = useCallback<IsValidConnection<WireType>>(
    connection => {
      const ends = endsOf(connection)
      if (ends === undefined) return false

      const check = checkConnection({ flow, catalogue, ...ends })
      lastRefusal.current = check.legal ? undefined : check.reasonKey
      return check.legal
    },
    [flow]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const ends = endsOf(connection)
      if (ends === undefined) return

      const check = checkConnection({ flow, catalogue, ...ends })
      if (!check.legal) return

      lastRefusal.current = undefined
      setRefusal(undefined)
      editor.connectWire({ kind: check.kind, ...ends })
    },
    [flow, editor.connectWire]
  )

  /** Removing a Wire is removing it from the Project, however it was removed. */
  const onWiresChange = useCallback(
    (changes: EdgeChange<WireType>[]) => {
      for (const change of changes) {
        if (change.type === "remove") editor.disconnectWire(change.id)
      }
    },
    [editor.disconnectWire]
  )

  /** A new drag is a new question, so the last answer stops being shown. */
  const onConnectStart = useCallback(() => {
    lastRefusal.current = undefined
    setRefusal(undefined)
  }, [])

  /**
   * A refused Wire is told to the user in words. React Flow's own answer is to
   * drop the Wire on the floor, which leaves someone who does not know the
   * rules believing the application is broken.
   *
   * Only an outright refusal is worth saying. Letting go over empty Canvas
   * leaves `isValid` null, and that is someone changing their mind, not the
   * editor turning them down.
   */
  const onConnectEnd = useCallback<OnConnectEnd>((_event, state) => {
    if (state.isValid !== false) return
    setRefusal(lastRefusal.current)
    lastRefusal.current = undefined
  }, [])

  /**
   * What the catalogue offers this Flow. It is read off the Flow's Nodes, so a
   * Trigger becomes unavailable the moment one is dropped on the Canvas and is
   * offered again the moment it is gone.
   */
  const choices = useMemo(() => addableNodes(flow, catalogue), [flow])

  /**
   * A Node is added where the pointer was, not where the viewport happens to
   * start: the user is told it lands where they clicked, and a Canvas they have
   * panned or zoomed must keep that promise.
   */
  const placeNode = useCallback(
    (definition: NodeDefinition, at: ScreenPoint) => {
      editor.addNode(definition, screenToFlowPosition(at))
    },
    [editor.addNode, screenToFlowPosition]
  )

  return (
    <section aria-label={translate("canvas.label")} className="relative h-full w-full">
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
        </ReactFlow>
      </AddNodeMenu>

      {refusal !== undefined && (
        <p
          className="absolute inset-x-4 bottom-4 rounded-md border bg-background px-3 py-2 text-center text-sm"
          data-testid="connection-refusal"
          role="status"
        >
          {translateDefinitionKey(refusal)}
        </p>
      )}
    </section>
  )
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
