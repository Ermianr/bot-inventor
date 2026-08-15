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
import { translate } from "@/i18n/messages"
import {
  connectWire,
  createFlow,
  disconnectWire,
  type FlowRemoval,
  type FlowRename,
  moveNode,
  removeFlow,
  renameFlow,
  renameProject,
  setNodeField,
  updateFlow
} from "@/project/edits"

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
  /**
   * Adds an empty Flow, opens it, and says which one it made so the list can
   * put the user straight into naming it.
   */
  createFlow(): string
  /** Puts another Project on the Canvas: opening a file, or starting a new one. */
  replace(project: Project): void
  /** Names the Project. A blank name is refused and the old one kept. */
  renameProject(name: string): void
  /**
   * Names a Flow. Says why a name was refused so the list can explain it, and
   * leaves the Project untouched when it was.
   */
  renameFlow(flowId: string, name: string): FlowRename
  /**
   * Removes a Flow and opens whichever one the rule says comes next. Says when
   * it refused, so the list can tell the user why nothing happened.
   */
  removeFlow(flowId: string): FlowRemoval
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
     * The default name is the word the first Flow of a new Project is given, so
     * the Flows of one Project read as one set. It is translated here rather
     * than resolved when the row is drawn because from this moment it is the
     * user's text, saved in their file — the same as the Project's own name.
     *
     * The id is made here, before the Flow is, because the caller is told which
     * Flow to open there and then rather than after React has settled.
     */
    createFlow: useCallback(() => {
      const id = `flow-${crypto.randomUUID()}`
      // Added to whatever Project the state is holding by the time React gets
      // here, so a creation batched behind another edit neither puts that edit
      // back nor takes a name the edit beside it has just given a Flow.
      setProject(previous => createFlow(previous, id, translate("project.flow.default")))
      setOpenFlowId(id)
      return id
    }, []),
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
    /**
     * The name is the Project's, not the file's: the `.botinv` on disk keeps
     * the name it was saved under, and only the next Save As is offered this
     * one as a suggestion.
     */
    renameProject: useCallback((name: string) => {
      setProject(previous => renameProject(previous, name))
    }, []),
    /**
     * The rule lives in `edits.ts`, so what happens to a refused rename is
     * decided in one place: nothing. The refusal is handed back rather than
     * shown here, because the words belong to the list the user is looking at.
     */
    renameFlow: useCallback(
      (flowId: string, name: string) => {
        const rename = renameFlow(project, flowId, name)
        // Decided on the Project this render is showing, since the caller is
        // told there and then whether the name was taken; applied to whatever
        // Project the state is holding by the time React gets here, so a rename
        // batched behind another edit does not put that edit back.
        if (rename.renamed) {
          setProject(previous => {
            const applied = renameFlow(previous, flowId, name)
            return applied.renamed ? applied.project : previous
          })
        }
        return rename
      },
      [project]
    ),
    /**
     * Which Flow opens next is the rule's answer, not this hook's: it is
     * decided in `edits.ts` and only obeyed here. The Canvas is moved before
     * the Project loses the Flow so that no render is left pointing at one that
     * is not there — React applies both in the same pass either way.
     */
    removeFlow: useCallback(
      (flowId: string) => {
        const removal = removeFlow(project, flowId, flow.id)
        if (removal.removed) {
          // Moved only when the Flow that went is the one on screen, read from
          // the id the state is holding rather than from this render: a removal
          // batched behind another one must not move a Canvas that has already
          // moved somewhere else.
          setOpenFlowId(current => (current === flowId ? removal.open : current))
          // Applied to whatever Project the state is holding by the time React
          // gets here, the same as the other edits, so a removal batched behind
          // one of them does not put that edit back.
          setProject(previous => {
            const applied = removeFlow(previous, flowId, flow.id)
            return applied.removed ? applied.project : previous
          })
        }
        return removal
      },
      [project, flow.id]
    ),
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
