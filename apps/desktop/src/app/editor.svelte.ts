import { Cause, Effect, Exit, type ManagedRuntime, Option } from "effect";
import {
  groupDiagnostics,
  totals as diagnosticTotals,
  type Marks,
  type Totals,
} from "../editor/diagnostics";
import { sameValue } from "../editor/equal";
import {
  canRedo,
  canUndo,
  createHistory,
  record,
  redo,
  seal,
  undo,
  type Edit,
  type History,
} from "../editor/history";
import type {
  DiagnosticView,
  FieldSpec,
  Flow,
  JsonValue,
  Line,
  NodeSpec,
  OpenedProject,
  Project,
} from "../lib/bindings";
import {
  addFlow,
  addLine,
  addNode,
  freshFlowName,
  moveNode,
  removeLines,
  removeNodes,
  sameLine,
  withFlow,
  type LineEnd,
  type Position,
} from "../editor/ops";
import {
  addRow,
  getSetting,
  removeRow,
  renameAlias,
  setSetting,
  withSettings,
  type AliasError,
  type Settings,
} from "../editor/settings";
import { m } from "../paraglide/messages.js";
import { TauriBackend } from "../services/TauriBackend";
import { describeFailure } from "./failure";
import { runtime } from "./runtime";

export interface Notice {
  readonly kind: "error" | "info";
  readonly text: string;
}

/** How long the editor waits after a change before it validates. */
export const VALIDATION_DELAY_MS = 300;

/**
 * The bridge between the Effect services and the components: fibers write, components read.
 * Every edit of the open project goes through `commit`, the one place that records it in the
 * undo history and asks for it to be validated.
 */
export class EditorStore {
  constructor(
    private readonly rt: ManagedRuntime.ManagedRuntime<TauriBackend, never>,
    private readonly validationDelay: number = VALIDATION_DELAY_MS,
  ) {}

  catalog = $state.raw<readonly NodeSpec[]>([]);
  flowName = $state.raw<string | null>(null);
  busy = $state(false);
  notice = $state.raw<Notice | null>(null);
  /** Grows with every edit, accepted or not, so the canvas draws the model again. */
  revision = $state(0);
  /** What `validate_project` said about the project as it was when it answered. */
  diagnostics = $state.raw<readonly DiagnosticView[]>([]);
  /** The ids of the selected nodes of the flow that is shown. */
  selected = $state.raw<readonly string[]>([]);

  private history = $state.raw<History<Project> | null>(null);
  /** The project as it was last opened or saved. */
  private saved = $state.raw<Project | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  get project(): Project | null {
    return this.history?.present ?? null;
  }

  /** Whether the project differs, by value, from the one last opened or saved. */
  dirty = $derived(
    this.history !== null &&
      this.saved !== null &&
      !sameValue(this.history.present, this.saved),
  );

  /** Where the editor marks each diagnostic of the flow that is shown. */
  marks: Marks = $derived(
    groupDiagnostics(this.diagnostics, this.flowName, this.flow),
  );

  /** The errors and warnings of the whole project. */
  totals: Totals = $derived(diagnosticTotals(this.diagnostics));

  get canUndo(): boolean {
    return this.history !== null && canUndo(this.history);
  }

  get canRedo(): boolean {
    return this.history !== null && canRedo(this.history);
  }

  get flow(): Flow | null {
    if (this.project === null || this.flowName === null) return null;
    return this.project.flows[this.flowName] ?? null;
  }

  get flowNames(): string[] {
    return this.project === null ? [] : Object.keys(this.project.flows);
  }

  loadCatalog(): void {
    const program = Effect.flatMap(TauriBackend, (b) => b.nodeCatalog());
    void this.rt.runPromiseExit(program).then((exit) => {
      if (Exit.isSuccess(exit)) this.catalog = exit.value;
      else this.fail(exit.cause, m.error_catalog());
    });
  }

  newProject(name: string): void {
    if (!this.canReplace()) return;
    this.run(
      Effect.flatMap(TauriBackend, (b) => b.newProject(name)),
      (opened) => {
        this.open(opened);
      },
    );
  }

  openProject(): void {
    if (!this.canReplace()) return;
    this.run(
      Effect.flatMap(TauriBackend, (b) => b.openProject()),
      (opened) => {
        this.open(opened);
      },
    );
  }

  save(): void {
    const project = this.project;
    if (project === null || this.busy) return;
    this.run(
      Effect.flatMap(TauriBackend, (b) => b.saveProject(project)),
      () => {
        // An edit made while it was saving makes the project differ from this one again.
        this.saved = project;
        // What is typed after a save is a new step.
        this.sealHistory();
      },
    );
  }

  selectFlow(name: string): void {
    if (this.project !== null && name in this.project.flows) {
      this.flowName = name;
      this.setSelection([]);
    }
  }

  createFlow(): void {
    const project = this.project;
    if (project === null) return;
    const name = freshFlowName(project);
    this.commit(() => addFlow(project, name), { flow: name });
    this.flowName = name;
    this.setSelection([]);
  }

  addNodeAt(spec: NodeSpec, position: Position): void {
    this.editFlow((flow) => addNode(flow, spec, position).flow);
  }

  connect(from: LineEnd, to: string): boolean {
    let accepted = false;
    this.editFlow((flow) => {
      const result = addLine(flow, this.catalog, from, to);
      accepted = result.ok;
      return result.ok ? result.flow : flow;
    });
    return accepted;
  }

  /** Moves the nodes of one drag; they are one step of the history. */
  moveNodes(moves: readonly { id: string; position: Position }[]): void {
    this.editFlow((flow) =>
      moves.reduce(
        (next, move) => moveNode(next, move.id, move.position),
        flow,
      ),
    );
  }

  /** Deletes the nodes (and their lines) and the lines the canvas deleted. */
  remove(nodeIds: ReadonlySet<string>, lines: readonly Line[]): void {
    this.editFlow((flow) =>
      removeNodes(
        removeLines(flow, (line) => lines.some((l) => sameLine(l, line))),
        nodeIds,
      ),
    );
  }

  /**
   * Sets one setting of a node, by the path that compile uses; `undefined` removes it. Edits in a
   * row to the same field are one step of the history.
   */
  setSetting(nodeId: string, path: string, value: JsonValue | undefined): void {
    this.editSettings(nodeId, (settings) => setSetting(settings, path, value), {
      key: `${nodeId}\u0000${path}`,
    });
  }

  addListRow(
    nodeId: string,
    path: string,
    field: { readonly max: number; readonly item: readonly FieldSpec[] },
  ): void {
    this.editSettings(nodeId, (settings) => addRow(settings, path, field));
  }

  removeListRow(
    nodeId: string,
    path: string,
    index: number,
    required: boolean,
  ): void {
    this.editSettings(nodeId, (settings) =>
      removeRow(settings, path, index, required),
    );
  }

  /** Why `alias` cannot be the alias of this node, or `null` when it can. Changes nothing. */
  checkAlias(nodeId: string, alias: string): AliasError | null {
    const flow = this.flow;
    if (flow === null) return "unknown-node";
    const result = renameAlias(flow, nodeId, alias);
    return result.ok ? null : result.error;
  }

  /** Renames a node; `null` when it worked, or why it did not (nothing changes then). */
  renameAlias(nodeId: string, alias: string): AliasError | null {
    const flow = this.flow;
    if (flow === null) return "unknown-node";
    const result = renameAlias(flow, nodeId, alias);
    if (!result.ok) return result.error;
    this.editFlow(() => result.flow, `${nodeId}\u0000alias`);
    return null;
  }

  /** The current value of a setting of a node, for the panel. */
  setting(nodeId: string, path: string): JsonValue | undefined {
    const node = this.flow?.nodes.find((n) => n.id === nodeId);
    return node === undefined ? undefined : getSetting(node.settings, path);
  }

  undo(): void {
    const history = this.history;
    if (history === null) return;
    const result = undo(history);
    this.travel(result.history, result.flow);
  }

  redo(): void {
    const history = this.history;
    if (history === null) return;
    const result = redo(history);
    this.travel(result.history, result.flow);
  }

  /** The selection of the canvas. A change of selection closes the step being typed. */
  setSelection(ids: readonly string[]): void {
    if (
      ids.length === this.selected.length &&
      ids.every((id, i) => id === this.selected[i])
    ) {
      return;
    }
    this.selected = ids;
    this.sealHistory();
  }

  dismissNotice(): void {
    this.notice = null;
  }

  private travel(history: History<Project>, flow: string | null): void {
    if (history === this.history) return;
    this.history = history;
    const project = history.present;
    // Shows the flow the step touched; if it is gone, or the step touched none, the current one
    // when it is still there, and the first otherwise.
    const target =
      flow !== null && flow in project.flows
        ? flow
        : this.flowName !== null && this.flowName in project.flows
          ? this.flowName
          : (Object.keys(project.flows)[0] ?? null);
    if (target !== this.flowName) this.selected = [];
    this.flowName = target;
    this.revision += 1;
    this.scheduleValidation();
  }

  private editSettings(
    nodeId: string,
    change: (settings: Settings) => Settings,
    edit: { readonly key?: string } = {},
  ): void {
    this.editFlow((flow) => {
      const node = flow.nodes.find((n) => n.id === nodeId);
      return node === undefined
        ? flow
        : withSettings(flow, nodeId, change(node.settings));
    }, edit.key);
  }

  private editFlow(change: (flow: Flow) => Flow, key?: string): void {
    const flowName = this.flowName;
    const flow = this.flow;
    if (flowName === null || flow === null) return;
    this.commit(
      (project) => {
        const next = change(flow);
        return next === flow ? project : withFlow(project, flowName, next);
      },
      { flow: flowName, key: key ?? null },
    );
  }

  private commit(change: (project: Project) => Project, edit: Edit): void {
    const history = this.history;
    if (history === null) return;
    const next = record(history, change(history.present), edit);
    this.revision += 1;
    if (next === history) return;
    this.history = next;
    this.scheduleValidation();
  }

  private sealHistory(): void {
    if (this.history !== null) this.history = seal(this.history);
  }

  private canReplace(): boolean {
    if (this.busy) return false;
    if (this.dirty) {
      this.notice = { kind: "error", text: m.notice_unsaved() };
      return false;
    }
    return true;
  }

  private open(opened: OpenedProject | null): void {
    if (opened === null) return;
    this.history = createHistory(opened.project);
    this.saved = opened.project;
    this.flowName = Object.keys(opened.project.flows)[0] ?? null;
    this.selected = [];
    this.diagnostics = [];
    this.revision += 1;
    const from = opened.migrated_from;
    this.notice =
      from == null
        ? null
        : { kind: "info", text: m.notice_migrated({ version: from }) };
    this.scheduleValidation(0);
  }

  /**
   * Validates after a quiet moment. An answer is shown only if the project is still the one that
   * was asked about; a later change has asked again.
   */
  private scheduleValidation(delay: number = this.validationDelay): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const project = this.project;
      if (project === null) return;
      const program = Effect.flatMap(TauriBackend, (b) =>
        b.validateProject(project),
      );
      void this.rt.runPromiseExit(program).then((exit) => {
        if (this.project !== project || !Exit.isSuccess(exit)) return;
        this.diagnostics = exit.value;
      });
    }, delay);
  }

  private run<A>(
    program: Effect.Effect<A, unknown, TauriBackend>,
    done: (value: A) => void,
  ): void {
    this.busy = true;
    this.notice = null;
    void this.rt.runPromiseExit(program).then((exit) => {
      this.busy = false;
      if (Exit.isSuccess(exit)) done(exit.value);
      else this.fail(exit.cause, m.error_backend());
    });
  }

  private fail(cause: Cause.Cause<unknown>, fallback: string): void {
    const error = Option.getOrUndefined(Cause.findErrorOption(cause));
    this.notice = {
      kind: "error",
      text: error === undefined ? fallback : describeFailure(error),
    };
  }
}

export const editor = new EditorStore(runtime);
