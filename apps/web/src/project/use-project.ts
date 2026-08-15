import { catalogue, pruneProjectWires } from "@bot-inventor/nodes"
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
  /** Puts another Project on the Canvas: opening a file, or starting a new one. */
  replace(project: Project): void
  moveNode(nodeId: string, position: Position): void
  setNodeField(nodeId: string, fieldId: string, value: FieldValue): void
  connectWire(wire: { kind: WireKind; from: PortReference; to: PortReference }): void
  disconnectWire(wireId: string): void
}

/** `createInitial` is called once: the Project the editor opens with. */
export function useProject(createInitial: () => Project): ProjectEditor {
  const [project, setProject] = useState(createInitial)
  const [openFlowId, setOpenFlowId] = useState(() => project.flows[0]?.id ?? "")

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
    /**
     * Opens a Project, reconciled with the catalogue this build has.
     *
     * A Wire whose Port is not there cannot be drawn — React Flow renders no
     * edge for a handle that does not exist — so it cannot be removed on the
     * Canvas either, while the Compiler refuses to run or export the Flow that
     * holds it. Clearing it on the way in is the only reading under which the
     * user is not locked out of their own Project by something invisible.
     */
    replace: useCallback((next: Project) => {
      setProject(pruneProjectWires(next, catalogue))
      setOpenFlowId(next.flows[0]?.id ?? "")
    }, []),
    moveNode: useCallback(
      (nodeId, position) => edit(current => moveNode(current, nodeId, position)),
      [edit]
    ),
    setNodeField: useCallback(
      (nodeId, fieldId, value) =>
        edit(current => setNodeField(current, catalogue, nodeId, fieldId, value)),
      [edit]
    ),
    connectWire: useCallback(wire => edit(current => connectWire(current, wire)), [edit]),
    disconnectWire: useCallback(wireId => edit(current => disconnectWire(current, wireId)), [edit])
  }
}
