import { Context, Effect, Layer, Schema } from "effect";
import { commands, type AppInfo } from "../lib/bindings";

/** A call to the Rust backend failed. */
export class BackendError extends Schema.TaggedError<BackendError>()(
  "BackendError",
  {
    command: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * The only door to the Rust backend: components and other services never call a Tauri command
 * directly (`docs/DEVELOPMENT-GUIDE.md` §1.9).
 */
export class TauriBackend extends Context.Service<
  TauriBackend,
  {
    appInfo(): Effect.Effect<AppInfo, BackendError>;
  }
>()("bot-inventor/services/TauriBackend") {
  static readonly layer = Layer.succeed(
    TauriBackend,
    TauriBackend.of({
      appInfo: () =>
        Effect.tryPromise({
          try: () => commands.appInfo(),
          catch: (cause) => new BackendError({ command: "app_info", cause }),
        }),
    }),
  );

  /** Answers from memory, so logic that uses the backend is tested without Tauri. */
  static readonly layerTest = (info: AppInfo) =>
    Layer.succeed(
      TauriBackend,
      TauriBackend.of({ appInfo: () => Effect.succeed(info) }),
    );
}
