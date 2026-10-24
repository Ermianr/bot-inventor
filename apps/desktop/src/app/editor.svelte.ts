import { Cause, Effect, Exit, type ManagedRuntime, Option } from "effect";
import type {
  Flow,
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
import { m } from "../paraglide/messages.js";
import { TauriBackend } from "../services/TauriBackend";
import { describeFailure } from "./failure";
import { runtime } from "./runtime";

export interface Notice {
  readonly kind: "error" | "info";
  readonly text: string;
}

/**
 * The bridge between the Effect services and the components: fibers write, components read.
 * Every edit of the open project goes through `edit`, the one place that marks it as changed.
 */
export class EditorStore {
  constructor(
    private readonly rt: ManagedRuntime.ManagedRuntime<TauriBackend, never>,
  ) {}

  catalog = $state.raw<readonly NodeSpec[]>([]);
  project = $state.raw<Project | null>(null);
  flowName = $state.raw<string | null>(null);
  dirty = $state(false);
  busy = $state(false);
  notice = $state.raw<Notice | null>(null);
  /** Grows with every edit, accepted or not, so the canvas draws the model again. */
  revision = $state(0);

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
        // An edit made while it was saving stays marked as unsaved.
        if (this.project === project) this.dirty = false;
      },
    );
  }

  selectFlow(name: string): void {
    if (this.project !== null && name in this.project.flows) {
      this.flowName = name;
    }
  }

  createFlow(): void {
    const project = this.project;
    if (project === null) return;
    const name = freshFlowName(project);
    this.edit(() => addFlow(project, name));
    this.flowName = name;
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

  moveNode(id: string, position: Position): void {
    this.editFlow((flow) => moveNode(flow, id, position));
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

  dismissNotice(): void {
    this.notice = null;
  }

  private editFlow(change: (flow: Flow) => Flow): void {
    const flowName = this.flowName;
    const flow = this.flow;
    if (flowName === null || flow === null) return;
    this.edit((project) => {
      const next = change(flow);
      return next === flow ? project : withFlow(project, flowName, next);
    });
  }

  private edit(change: (project: Project) => Project): void {
    const project = this.project;
    if (project === null) return;
    const next = change(project);
    this.revision += 1;
    if (next === project) return;
    this.project = next;
    this.dirty = true;
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
    this.project = opened.project;
    this.flowName = Object.keys(opened.project.flows)[0] ?? null;
    this.dirty = false;
    this.revision += 1;
    const from = opened.migrated_from;
    this.notice =
      from == null
        ? null
        : { kind: "info", text: m.notice_migrated({ version: from }) };
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
