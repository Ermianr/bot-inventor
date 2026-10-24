import { Channel } from "@tauri-apps/api/core";
import { Context, Effect, Layer, Schema } from "effect";
import {
  commands,
  type AppInfo,
  type Condition,
  type DiagnosticView,
  type ExportOutcome,
  type NameList,
  type NodeSpec,
  type OpenedProject,
  type Project,
  type Renamed,
  type RunEvent,
  type RunSettings,
  type StartOutcome,
  type StopResult,
} from "../lib/bindings";

/** A call to the Rust backend failed. */
export class BackendError extends Schema.TaggedError<BackendError>()(
  "BackendError",
  {
    command: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** The result a command that can fail gives back (`typedError` in the generated bindings). */
type Checked<T> =
  { status: "ok"; data: T } | { status: "error"; error: unknown };

export interface Backend {
  appInfo(): Effect.Effect<AppInfo, BackendError>;
  /** The schema of every node type. */
  nodeCatalog(): Effect.Effect<NodeSpec[], BackendError>;
  /** Asks for an empty folder and creates a project there; `null` when the person cancels. */
  newProject(name: string): Effect.Effect<OpenedProject | null, BackendError>;
  /** Asks for a project folder and opens it; `null` when the person cancels. */
  openProject(): Effect.Effect<OpenedProject | null, BackendError>;
  /** Saves to the folder that was opened or created. */
  saveProject(project: Project): Effect.Effect<void, BackendError>;
  validateProject(
    project: Project,
  ): Effect.Effect<DiagnosticView[], BackendError>;
  /** The names that an expression of a node can read, for the lists of the condition builder. */
  expressionNames(
    project: Project,
    flow: string,
    node: string,
  ): Effect.Effect<NameList, BackendError>;
  /** The expression that a condition of the builder spells. */
  conditionToSource(condition: Condition): Effect.Effect<string, BackendError>;
  /** The condition that an expression spells; `null` when it has another shape. */
  conditionFromSource(
    source: string,
  ): Effect.Effect<Condition | null, BackendError>;
  /** A new alias for a node and every read of the old one in its flow. */
  renameAlias(
    project: Project,
    flow: string,
    node: string,
    alias: string,
  ): Effect.Effect<Renamed, BackendError>;
  /**
   * Compiles the project as shown and starts the bot. Its output arrives through `onEvent`, in
   * order, until the bot exits.
   */
  startBot(
    project: Project,
    onEvent: (event: RunEvent) => void,
  ): Effect.Effect<StartOutcome, BackendError>;
  /** Stops the bot and waits until it has stopped. */
  stopBot(): Effect.Effect<StopResult, BackendError>;
  /**
   * Writes the bot token to the project's `.env`. It is the only call that carries the token and
   * nothing returns it: `tokenStatus` says only whether one is set.
   */
  setToken(token: string): Effect.Effect<void, BackendError>;
  tokenStatus(): Effect.Effect<RunSettings, BackendError>;
  /** Sets the development server, or removes it with `null`. */
  setDevGuild(guild: string | null): Effect.Effect<void, BackendError>;
  /** Asks for a folder and exports the bot there; `null` when the person cancels. */
  exportBot(
    project: Project,
    name: string,
  ): Effect.Effect<ExportOutcome | null, BackendError>;
}

function call<T>(
  command: string,
  run: () => Promise<T>,
): Effect.Effect<T, BackendError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new BackendError({ command, cause }),
  });
}

/** A command whose Rust side returns a `Result`: an `Err` becomes a `BackendError` too. */
function callChecked<T>(
  command: string,
  run: () => Promise<Checked<T>>,
): Effect.Effect<T, BackendError> {
  return call(command, run).pipe(
    Effect.flatMap((result) =>
      result.status === "ok"
        ? Effect.succeed(result.data)
        : Effect.fail(new BackendError({ command, cause: result.error })),
    ),
  );
}

/**
 * The only door to the Rust backend: components and other services never call a Tauri command
 * directly (`docs/DEVELOPMENT-GUIDE.md` §1.9).
 */
export class TauriBackend extends Context.Service<TauriBackend, Backend>()(
  "bot-inventor/services/TauriBackend",
) {
  static readonly layer = Layer.succeed(
    TauriBackend,
    TauriBackend.of({
      appInfo: () => call("app_info", () => commands.appInfo()),
      nodeCatalog: () => call("node_catalog", () => commands.nodeCatalog()),
      newProject: (name) =>
        callChecked("new_project", () => commands.newProject(name)),
      openProject: () =>
        callChecked("open_project", () => commands.openProject()),
      saveProject: (project) =>
        callChecked("save_project", () => commands.saveProject(project)).pipe(
          Effect.asVoid,
        ),
      validateProject: (project) =>
        call("validate_project", () => commands.validateProject(project)),
      expressionNames: (project, flow, node) =>
        callChecked("expression_names", () =>
          commands.expressionNames(project, flow, node),
        ),
      conditionToSource: (condition) =>
        callChecked("condition_to_source", () =>
          commands.conditionToSource(condition),
        ),
      conditionFromSource: (source) =>
        callChecked("condition_from_source", () =>
          commands.conditionFromSource(source),
        ),
      renameAlias: (project, flow, node, alias) =>
        callChecked("rename_alias", () =>
          commands.renameAlias(project, flow, node, alias),
        ),
      startBot: (project, onEvent) =>
        callChecked("start_bot", () => {
          const events = new Channel<RunEvent>();
          events.onmessage = onEvent;
          return commands.startBot(project, events);
        }),
      stopBot: () => callChecked("stop_bot", () => commands.stopBot()),
      setToken: (token) =>
        callChecked("set_token", () => commands.setToken(token)).pipe(
          Effect.asVoid,
        ),
      tokenStatus: () =>
        callChecked("token_status", () => commands.tokenStatus()),
      setDevGuild: (guild) =>
        callChecked("set_dev_guild", () => commands.setDevGuild(guild)).pipe(
          Effect.asVoid,
        ),
      exportBot: (project, name) =>
        callChecked("export_bot", () => commands.exportBot(project, name)),
    }),
  );

  /** Answers from memory, so logic that uses the backend is tested without Tauri. */
  static readonly layerTest = (
    info: AppInfo,
    overrides: Partial<Backend> = {},
  ) =>
    Layer.succeed(
      TauriBackend,
      TauriBackend.of({
        appInfo: () => Effect.succeed(info),
        nodeCatalog: () => Effect.succeed([]),
        newProject: () => Effect.succeed(null),
        openProject: () => Effect.succeed(null),
        saveProject: () => Effect.void,
        validateProject: () => Effect.succeed([]),
        expressionNames: () => Effect.succeed({ order_known: true, names: [] }),
        conditionToSource: () => Effect.succeed(""),
        conditionFromSource: () => Effect.succeed(null),
        renameAlias: (project) =>
          Effect.succeed({ project, rewritten: [], left_alone: [] }),
        startBot: () => Effect.succeed({ outcome: "started" }),
        stopBot: () => Effect.succeed("not_running"),
        setToken: () => Effect.void,
        tokenStatus: () =>
          Effect.succeed({ token_set: false, dev_guild: null }),
        setDevGuild: () => Effect.void,
        exportBot: () => Effect.succeed(null),
        ...overrides,
      }),
    );
}
