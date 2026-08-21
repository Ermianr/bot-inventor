import { type NodeDefinition, type PortDefinition, portsOf } from "@bot-inventor/nodes"
import type { FieldValue, Node } from "@bot-inventor/schema"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from "@bot-inventor/ui/components/context-menu"
import {
  Handle,
  Position as HandlePosition,
  type NodeProps,
  type Node as ReactFlowNode
} from "@xyflow/react"

import { drawnFields, FieldRow } from "@/canvas/field-row"
import { NodeSummaryRow } from "@/canvas/node-summary"
import { translate, translateDefinitionKey } from "@/i18n/messages"
import type { NodeRunState } from "@/session/trace"

/**
 * A Node on the Canvas: what it is, the values typed into it, and the Ports
 * its Wires leave from and arrive at.
 *
 * Every Node of the catalogue is drawn by this one component, from its
 * definition. A Node that needed its own component would be a Node the
 * catalogue cannot describe, and adding Nodes is this product's permanent
 * activity (ADR 0001).
 */

export type FlowNodeData = {
  node: Node
  definition: NodeDefinition
  /** How far the run being watched got in this Node, if it reached it at all. */
  runState: NodeRunState | undefined
  setField: (fieldId: string, value: FieldValue) => void
  /**
   * What the pill for one of this Node's Slots says: where its value comes
   * from, or that nothing feeds it yet. The Wire that answers it is the Flow's,
   * so the Canvas answers it and the Node only draws it.
   */
  slotLabel: (slot: string) => string
  /** Whether a Wire feeds this Slot, which is what removing its last pill costs. */
  slotIsWired: (slot: string) => boolean
  /** Takes this Node off the Canvas, and its Wires with it. */
  remove: () => void
}

/**
 * How a Node reached by the run being watched is drawn. Running and done are
 * told apart so that a Node the bot is stuck in is visible as such, and a
 * failure is the one that has to be findable at a glance.
 */
const RUN_STATE_RING: Record<NodeRunState, string> = {
  entered: "ring-2 ring-amber-500",
  completed: "ring-2 ring-emerald-500",
  failed: "ring-2 ring-destructive"
}

export type FlowNodeType = ReactFlowNode<FlowNodeData, "flowNode">

export function FlowNode({ id, data }: NodeProps<FlowNodeType>) {
  const { node, definition, runState, setField, slotIsWired, slotLabel, remove } = data
  const ports = portsOf(definition, node.fields)
  const inputs = ports.filter(port => port.direction === "input")
  const outputs = ports.filter(port => port.direction === "output")
  const highlight = runState === undefined ? "" : ` ${RUN_STATE_RING[runState]}`
  // What the user typed that whatever reads this Node would refuse. It is the
  // Node's own answer, so every Node that can say something wrong says it here.
  const problems = definition.problems?.(node.fields) ?? []

  return (
    /*
      A right-click on a Node is the Node's question, not the Canvas's. The
      Canvas is the outer context menu, and this stops the event once this one
      has answered it, so the user is never offered both menus at once. The
      browser's own menu is turned down here as well: a right-click that offers
      the editor's menu in one place and Chrome's in another reads as the
      application breaking, and that must hold anywhere on the Node, including
      the edges the trigger under this does not itself cover.
    */
    // biome-ignore lint/a11y/noStaticElementInteractions: the menu the handler guards is the interactive element.
    <div
      onContextMenu={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger
          className={`w-64 rounded-lg border bg-card text-card-foreground shadow-sm${highlight}`}
          data-run-state={runState}
          data-testid={`node-${id}`}
        >
          <header className="border-b px-3 py-2">
            <p className="text-sm font-medium">{translateDefinitionKey(definition.labelKey)}</p>
            <p className="text-xs text-muted-foreground">
              {translateDefinitionKey(definition.descriptionKey)}
            </p>
          </header>

          <div className="grid gap-1 py-2">
            {inputs.map(port => (
              <PortRow key={`in-${port.id}`} nodeId={id} port={port} />
            ))}
            {outputs.map(port => (
              <PortRow key={`out-${port.id}`} nodeId={id} port={port} />
            ))}
          </div>

          {problems.length > 0 && (
            <div
              className="border-t bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid={`node-problems-${id}`}
            >
              {problems.map(problem => (
                <p key={problem.messageKey}>
                  {translateDefinitionKey(problem.messageKey, problem.values)}
                </p>
              ))}
            </div>
          )}

          {/*
            A Node the user types into on the Canvas draws its fields; one whose
            fields are typed into the Inspector draws the summary it declared
            instead, so that the Flow stays readable as a Flow.
          */}
          <div className="grid gap-2 border-t px-3 py-2">
            {definition.summary === undefined ? (
              drawnFields(definition.fields).map(field => (
                <FieldRow
                  key={field.id}
                  field={field}
                  nodeId={id}
                  setField={setField}
                  slotIsWired={slotIsWired}
                  slotLabel={slotLabel}
                  value={node.fields[field.id] ?? field.defaultValue}
                />
              ))
            ) : (
              <NodeSummaryRow
                fields={node.fields}
                nodeId={id}
                slotLabel={slotLabel}
                summary={definition.summary}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem data-testid={`node-remove-${id}`} onClick={remove} variant="destructive">
            {translate("canvas.node.remove")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

/**
 * One Port and the Handle its Wires attach to. `Handle` is React Flow's word
 * for the thing the pointer grabs; ours is Port, and this is the boundary
 * where the two meet.
 */
function PortRow({ nodeId, port }: { nodeId: string; port: PortDefinition }) {
  const isInput = port.direction === "input"

  return (
    <div className={`relative px-3 text-xs ${isInput ? "text-left" : "text-right"}`}>
      <Handle
        className={port.kind === "execution" ? "!h-3 !w-3 !rounded-sm" : "!h-3 !w-3"}
        data-testid={`port-${nodeId}-${port.id}`}
        id={port.id}
        position={isInput ? HandlePosition.Left : HandlePosition.Right}
        type={isInput ? "target" : "source"}
      />
      {/* A Port the user named is shown in their own words; the rest are translated. */}
      <span>{port.label ?? translateDefinitionKey(port.labelKey)}</span>
    </div>
  )
}
