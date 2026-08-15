import {
  type FieldDefinition,
  type NodeDefinition,
  type PortDefinition,
  portsOf
} from "@bot-inventor/nodes"
import type { FieldValue, Node } from "@bot-inventor/schema"
import { Checkbox } from "@bot-inventor/ui/components/checkbox"
import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"
import {
  Handle,
  Position as HandlePosition,
  type NodeProps,
  type Node as ReactFlowNode
} from "@xyflow/react"
import { translateDefinitionKey } from "@/i18n/messages"
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

/**
 * `commandParameters` is not drawn yet: it is a list of declarations rather
 * than one value, and it needs a control of its own. A Flow can already read
 * what the caller answered — the Ports are there as soon as the field holds
 * parameters — so what is left is the editing surface.
 */
const DRAWN_CONTROLS = new Set<FieldDefinition["control"]>(["text", "number", "switch"])

export function FlowNode({ id, data }: NodeProps<FlowNodeType>) {
  const { node, definition, runState, setField } = data
  const ports = portsOf(definition, node.fields)
  const inputs = ports.filter(port => port.direction === "input")
  const outputs = ports.filter(port => port.direction === "output")
  const highlight = runState === undefined ? "" : ` ${RUN_STATE_RING[runState]}`

  return (
    <div
      className={`w-64 rounded-lg border bg-card text-card-foreground shadow-sm${highlight}`}
      data-run-state={runState}
      data-testid={`node-${id}`}
    >
      <header className="border-b px-3 py-2">
        <p className="font-medium text-sm">{translateDefinitionKey(definition.labelKey)}</p>
        <p className="text-muted-foreground text-xs">
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

      <div className="grid gap-2 border-t px-3 py-2">
        {definition.fields
          .filter(field => DRAWN_CONTROLS.has(field.control))
          .map(field => (
            <FieldRow
              key={field.id}
              field={field}
              nodeId={id}
              setField={setField}
              value={node.fields[field.id] ?? field.defaultValue}
            />
          ))}
      </div>
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

function FieldRow({
  field,
  nodeId,
  setField,
  value
}: {
  field: FieldDefinition
  nodeId: string
  setField: (fieldId: string, value: FieldValue) => void
  value: FieldValue
}) {
  const inputId = `${nodeId}-${field.id}`
  const label = translateDefinitionKey(field.labelKey)

  if (field.control === "switch") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          checked={value === true}
          id={inputId}
          onCheckedChange={checked => setField(field.id, checked === true)}
        />
        <Label className="text-xs" htmlFor={inputId}>
          {label}
        </Label>
      </div>
    )
  }

  return (
    <div className="grid gap-1">
      <Label className="text-xs" htmlFor={inputId}>
        {label}
      </Label>
      <Input
        className="nodrag h-8"
        id={inputId}
        onChange={event =>
          setField(
            field.id,
            field.control === "number" ? Number(event.target.value) : event.target.value
          )
        }
        type={field.control === "number" ? "number" : "text"}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
      />
    </div>
  )
}
