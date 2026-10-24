import { describe, expect, it } from "@effect/vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Effect } from "effect";
import { afterEach } from "vitest";
import type { Condition, Project } from "../lib/bindings";
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

describe("TauriBackend commands of the condition builder", () => {
  // `mockIPC` puts itself on `window`, which a Node test does not have.
  Object.assign(globalThis, { window: globalThis });
  afterEach(() => {
    clearMocks();
  });

  const project = { flows: {} } as unknown as Project;
  const condition: Condition = { join: "All", rows: [] };

  it.effect("calls each command by its name with its arguments", () =>
    Effect.gen(function* () {
      const calls: { cmd: string; args: unknown }[] = [];
      mockIPC((cmd, args) => {
        calls.push({ cmd, args });
        switch (cmd) {
          case "expression_names":
            return { order_known: true, names: [] };
          case "condition_to_source":
            return "event.user.id == 'x'";
          case "condition_from_source":
            return null;
          default:
            return { project, rewritten: [], left_alone: [] };
        }
      });
      const backend = yield* TauriBackend;
      expect(yield* backend.expressionNames(project, "main", "n1")).toEqual({
        order_known: true,
        names: [],
      });
      expect(yield* backend.conditionToSource(condition)).toBe(
        "event.user.id == 'x'",
      );
      expect(yield* backend.conditionFromSource("a")).toBeNull();
      yield* backend.renameAlias(project, "main", "n1", "fresh");
      expect(calls).toEqual([
        {
          cmd: "expression_names",
          args: { project, flow: "main", node: "n1" },
        },
        { cmd: "condition_to_source", args: { condition } },
        { cmd: "condition_from_source", args: { source: "a" } },
        {
          cmd: "rename_alias",
          args: { project, flow: "main", node: "n1", alias: "fresh" },
        },
      ]);
    }).pipe(Effect.provide(TauriBackend.layer)),
  );

  it.effect("turns an error of Rust into a BackendError that keeps it", () =>
    Effect.gen(function* () {
      mockIPC(() =>
        // Tauri rejects with the serialized error as it is, not with an `Error`.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({ kind: "invalid_input", message: "bad alias" }),
      );
      const backend = yield* TauriBackend;
      const exit = yield* Effect.exit(
        backend.renameAlias(project, "main", "n1", "X"),
      );
      expect(exit._tag).toBe("Failure");
      const error = yield* Effect.flip(
        backend.renameAlias(project, "main", "n1", "X"),
      );
      expect(error.cause).toEqual({
        kind: "invalid_input",
        message: "bad alias",
      });
    }).pipe(Effect.provide(TauriBackend.layer)),
  );
});
