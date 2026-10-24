import { Cause, Effect, Exit, type ManagedRuntime, Option } from "effect";
import type { Totals } from "../editor/diagnostics";
import {
  appendLines,
  clearLog,
  emptyLog,
  type LogBuffer,
} from "../editor/logs";
import type {
  LogLine,
  Project,
  RunEvent,
  RunSettings,
  RunStatus,
} from "../lib/bindings";
import { m } from "../paraglide/messages.js";
import { TauriBackend } from "../services/TauriBackend";
import type { Notice, Reply } from "./editor.svelte";
import { editor } from "./editor.svelte";
import { describeFailure } from "./failure";
import { runtime } from "./runtime";

/** Where the bot is: not started yet, on its way up or down, running, or gone. */
export type Phase = "idle" | "starting" | "running" | "stopping" | "exited";

export type Exited = Extract<RunStatus, { state: "exited" }>;

/** Why the bot cannot be run now, or `null` when it can. */
export type RunBlocker = "no-project" | "errors" | "running";

/** What the export did. */
export type ExportResult =
  | { readonly kind: "exported"; readonly path: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "invalid" }
  | { readonly kind: "failed"; readonly message: string };

/** What the run store needs from the editor: the project it shows and a place for messages. */
export interface RunHost {
  readonly project: Project | null;
  readonly totals: Totals;
  notice: Notice | null;
  /** Set while a bot runs, so the project cannot be replaced under it. */
  locked: boolean;
  revalidate(): void;
}

/** How long lines are held to be added together; a burst then costs one update, not one each. */
export const FLUSH_DELAY_MS = 16;

/**
 * The bridge between the run services and the components: fibers write, components read. It
 * never holds the bot token: the token is the argument of one call and goes no further.
 */
export class RunStore {
  constructor(
    private readonly rt: ManagedRuntime.ManagedRuntime<TauriBackend, never>,
    private readonly host: RunHost,
    private readonly flushDelay: number = FLUSH_DELAY_MS,
  ) {}

  phase = $state<Phase>("idle");
  /** How the last bot ended, while `phase` is `exited`. */
  exit = $state.raw<Exited | null>(null);
  log = $state.raw<LogBuffer>(emptyLog);
  /** Whether a token is set and the development server; `null` until it is known. */
  settings = $state.raw<RunSettings | null>(null);
  exporting = $state(false);
  /**
   * Whether the log panel is open. It stays out of the way while the bot is edited and opens when
   * the bot starts; the person can open and close it at any time.
   */
  logOpen = $state(false);

  private queue: LogLine[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** A bot is on its way up, running or on its way down. */
  get active(): boolean {
    return (
      this.phase === "starting" ||
      this.phase === "running" ||
      this.phase === "stopping"
    );
  }

  get blocker(): RunBlocker | null {
    if (this.host.project === null) return "no-project";
    if (this.active) return "running";
    if (this.host.totals.errors > 0) return "errors";
    return null;
  }

  get canStop(): boolean {
    return this.phase === "starting" || this.phase === "running";
  }

  /** Compiles the project as it is shown and starts the bot. */
  start(): void {
    const project = this.host.project;
    if (project === null || this.blocker !== null) return;
    this.phase = "starting";
    this.exit = null;
    this.discardQueue();
    this.log = clearLog(this.log);
    this.logOpen = true;
    this.host.locked = true;
    this.host.notice = null;
    const program = Effect.flatMap(TauriBackend, (b) =>
      b.startBot(project, (event) => {
        this.onEvent(event);
      }),
    );
    void this.rt.runPromiseExit(program).then((exit) => {
      if (!Exit.isSuccess(exit)) {
        this.release();
        this.host.notice = {
          kind: "error",
          text: this.failure(exit.cause),
        };
        return;
      }
      if (exit.value.outcome === "invalid") {
        this.release();
        const count = exit.value.diagnostics.filter(
          (d) => d.severity === "error",
        ).length;
        this.host.notice = {
          kind: "error",
          text: m.run_notice_invalid({ count }),
        };
        this.host.revalidate();
      }
    });
  }

  /** Asks the bot to stop; the state follows the events. */
  stop(): void {
    if (!this.canStop) return;
    const program = Effect.flatMap(TauriBackend, (b) => b.stopBot());
    void this.rt.runPromiseExit(program).then((exit) => {
      if (!Exit.isSuccess(exit)) {
        this.host.notice = { kind: "error", text: this.failure(exit.cause) };
      } else if (exit.value === "not_running" && this.phase === "running") {
        // Nothing runs, and the exit never reached us: do not wait for it.
        this.release();
      }
    });
  }

  clear(): void {
    this.discardQueue();
    this.log = clearLog(this.log);
  }

  /** Reads whether a token is set; call it when a project is opened. */
  loadSettings(): void {
    if (this.host.project === null) {
      this.settings = null;
      return;
    }
    const program = Effect.flatMap(TauriBackend, (b) => b.tokenStatus());
    void this.rt.runPromiseExit(program).then((exit) => {
      this.settings = Exit.isSuccess(exit) ? exit.value : null;
    });
  }

  /**
   * Writes the token to the project's `.env`. The token is only ever the argument of this call;
   * what comes back is whether it worked.
   */
  async saveToken(token: string): Promise<Reply<null>> {
    return this.change(Effect.flatMap(TauriBackend, (b) => b.setToken(token)));
  }

  /** Sets the development server, or removes it with `null`. */
  async saveDevGuild(guild: string | null): Promise<Reply<null>> {
    return this.change(
      Effect.flatMap(TauriBackend, (b) => b.setDevGuild(guild)),
    );
  }

  /** Exports the bot: Rust asks for the folder. */
  async exportBot(name: string): Promise<ExportResult> {
    const project = this.host.project;
    if (project === null || this.exporting) {
      return { kind: "failed", message: m.error_no_project() };
    }
    this.exporting = true;
    const exit = await this.rt.runPromiseExit(
      Effect.flatMap(TauriBackend, (b) => b.exportBot(project, name)),
    );
    this.exporting = false;
    if (!Exit.isSuccess(exit)) {
      return { kind: "failed", message: this.failure(exit.cause) };
    }
    const outcome = exit.value;
    if (outcome === null) return { kind: "cancelled" };
    if (outcome.outcome === "invalid") {
      const count = outcome.diagnostics.filter(
        (d) => d.severity === "error",
      ).length;
      this.host.notice = {
        kind: "error",
        text: m.export_invalid({ count }),
      };
      this.host.revalidate();
      return { kind: "invalid" };
    }
    this.host.notice = {
      kind: "info",
      text: m.export_done({ path: outcome.path }),
    };
    return { kind: "exported", path: outcome.path };
  }

  private async change(
    program: Effect.Effect<void, unknown, TauriBackend>,
  ): Promise<Reply<null>> {
    const exit = await this.rt.runPromiseExit(program);
    if (!Exit.isSuccess(exit)) {
      return { ok: false, message: this.failure(exit.cause) };
    }
    this.loadSettings();
    return { ok: true, value: null };
  }

  private onEvent(event: RunEvent): void {
    if (event.kind === "log") {
      this.queue.push(event.data);
      this.timer ??= setTimeout(() => {
        this.flush();
      }, this.flushDelay);
      return;
    }
    // The lines that came before the state change are shown first.
    this.flush();
    const status = event.data;
    switch (status.state) {
      case "starting":
        this.phase = "starting";
        break;
      case "running":
        this.phase = "running";
        break;
      case "stopping":
        this.phase = "stopping";
        break;
      case "exited":
        this.phase = "exited";
        this.exit = status;
        this.host.locked = false;
        break;
    }
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.queue.length === 0) return;
    const lines = this.queue;
    this.queue = [];
    this.log = appendLines(this.log, lines);
  }

  private discardQueue(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }

  /** Back to "not running", for a bot that never started or whose exit never reached us. */
  private release(): void {
    this.phase = "idle";
    this.host.locked = false;
  }

  private failure(cause: Cause.Cause<unknown>): string {
    const error = Option.getOrUndefined(Cause.findErrorOption(cause));
    return error === undefined ? m.error_backend() : describeFailure(error);
  }
}

export const run = new RunStore(runtime, editor);
