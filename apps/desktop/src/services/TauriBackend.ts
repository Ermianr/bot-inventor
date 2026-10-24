import { Context, Effect, Layer, Schema } from "effect";
import {
  commands,
  type AppInfo,
  type DiagnosticView,
  type EditorError,
  type NodeSpec,
  type OpenedProject,
  type Project,
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
  { status: "ok"; data: T } | { status: "error"; error: EditorError };

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
        ...overrides,
      }),
    );
}
