import type {
  FieldValue,
  Flow,
  PortReference,
  Position,
  Project,
  WireKind
} from "@bot-inventor/schema"
import { useCallback, useMemo, useState } from "react"
import { connectWire, disconnectWire, moveNode, setNodeField, updateFlow } from "@/project/edits"

/**
 * The Project the editor is holding, and every change the Canvas can make to
 * it. One Flow is open at a time; the Flow list chooses which.
 *
 * The Project lives here rather than inside the Canvas because everything else
 * on screen — the Flow list, running the bot — reads the same one, and there is
 * exactly one answer to what the user has built.
 */
export type ProjectEditor = {
  project: Project
  /** The Flow the Canvas is showing. */
  flow: Flow
  openFlow(flowId: string): void
  moveNode(nodeId: string, position: Position): void
  setNodeField(nodeId: string, fieldId: string, value: FieldValue): void
  connectWire(wire: { kind: WireKind; from: PortReference; to: PortReference }): void
  disconnectWire(wireId: string): void
}

export function useProject(initial: Project): ProjectEditor {
  const [project, setProject] = useState(initial)
  const [openFlowId, setOpenFlowId] = useState(() => initial.flows[0]?.id ?? "")

  const flow = useMemo(() => {
    const open = project.flows.find(candidate => candidate.id === openFlowId)
    // A Project always has at least one Flow, and the list can only choose one
    // of the Flows it is rendering, so falling back is a formality.
    return open ?? project.flows[0] ?? { id: "", name: "", nodes: [], wires: [] }
  }, [project.flows, openFlowId])

  const edit = useCallback(
    (change: (flow: Flow) => Flow) => {
      setProject(previous => updateFlow(previous, flow.id, change))
    },
    [flow.id]
  )

  return {
    project,
    flow,
    openFlow: setOpenFlowId,
    moveNode: useCallback(
      (nodeId, position) => edit(current => moveNode(current, nodeId, position)),
      [edit]
    ),
    setNodeField: useCallback(
      (nodeId, fieldId, value) => edit(current => setNodeField(current, nodeId, fieldId, value)),
      [edit]
    ),
    connectWire: useCallback(wire => edit(current => connectWire(current, wire)), [edit]),
    disconnectWire: useCallback(wireId => edit(current => disconnectWire(current, wireId)), [edit])
  }
}
