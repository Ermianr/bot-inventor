import { catalogue, checkConnection, findCoercion, findFlowPort } from "@bot-inventor/nodes"
import type { PortReference, Wire as ProjectWire } from "@bot-inventor/schema"
import {
  Background,
  type Connection,
  Controls,
  type IsValidConnection,
  type NodeChange,
  type OnConnectEnd,
  ReactFlow,
  useNodesState
} from "@xyflow/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FlowNode, type FlowNodeData, type FlowNodeType } from "@/canvas/flow-node"
import { Wire, type WireData, type WireType } from "@/canvas/wire"
import { translate, translateDefinitionKey } from "@/i18n/messages"
import type { ProjectEditor } from "@/project/use-project"

import "@xyflow/react/dist/style.css"

/**
 * The Flow, drawn and editable.
 *
 * React Flow calls a Wire an edge and a Port a handle. Those words live in this
 * file and nowhere else: everything the rest of the editor is handed is spelled
 * the way `CONTEXT.md` spells it.
 *
 * Whether a Wire may be drawn is not decided here. `checkConnection` decides
 * it, from the same Coercion table the Compiler emits from, so a Wire the user
 * is allowed to draw is always one the Compiler accepts.
 */

const nodeTypes = { flowNode: FlowNode }
const wireTypes = { wire: Wire }

export function Canvas({ editor }: { editor: ProjectEditor }) {
  const { flow } = editor
  const [refusal, setRefusal] = useState<string | undefined>(undefined)

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
          setField: (fieldId, value) => editor.setNodeField(node.id, fieldId, value)
        }
        return [{ id: node.id, type: "flowNode" as const, position: node.position, data }]
      }),
    [flow.nodes, editor.setNodeField]
  )

  const wires = useMemo<WireType[]>(
    () =>
      flow.wires.map(wire => {
        const data: WireData = {
          kind: wire.kind,
          coercionLabelKey: coercionLabelKeyOf(flow, wire),
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
    [flow, editor.disconnectWire]
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

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNodeType>[]) => {
      applyNodeChanges(changes)
      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined) {
          editor.moveNode(change.id, change.position)
        }
      }
    },
    [applyNodeChanges, editor.moveNode]
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

  /**
   * A refused Wire is told to the user in words. React Flow's own answer is to
   * drop the Wire on the floor, which leaves someone who does not know the
   * rules believing the application is broken.
   */
  const onConnectEnd = useCallback<OnConnectEnd>((_event, state) => {
    if (state.isValid === true) return
    setRefusal(lastRefusal.current)
    lastRefusal.current = undefined
  }, [])

  return (
    <section aria-label={translate("canvas.label")} className="relative h-full w-full">
      <ReactFlow
        edgeTypes={wireTypes}
        edges={wires}
        fitView
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        nodes={drawn}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodesChange={onNodesChange}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>

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
