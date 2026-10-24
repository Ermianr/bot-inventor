import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Project } from "../lib/bindings";
import { BackendError, TauriBackend } from "./TauriBackend";

const info = { name: "Bot Inventor", version: "0.0.0" };

describe("TauriBackend", () => {
  it.effect("answers from memory with the test layer", () =>
    Effect.gen(function* () {
      const backend = yield* TauriBackend;
      expect(yield* backend.appInfo()).toEqual(info);
      expect(yield* backend.nodeCatalog()).toEqual([]);
      expect(yield* backend.openProject()).toBeNull();
    }).pipe(Effect.provide(TauriBackend.layerTest(info))),
  );

  it.effect("lets a test replace one call", () =>
    Effect.gen(function* () {
      const backend = yield* TauriBackend;
      const project = { flows: {} } as unknown as Project;
      const exit = yield* Effect.exit(backend.saveProject(project));
      expect(exit._tag).toBe("Failure");
    }).pipe(
      Effect.provide(
        TauriBackend.layerTest(info, {
          saveProject: () =>
            Effect.fail(
              new BackendError({
                command: "save_project",
                cause: { kind: "no_project" },
              }),
            ),
        }),
      ),
    ),
  );
});
