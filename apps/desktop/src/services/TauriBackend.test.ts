import { describe, expect, it } from "@effect/vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Effect } from "effect";
import { afterEach } from "vitest";
import type { Condition, Project, RunEvent } from "../lib/bindings";
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

describe("TauriBackend commands of local run and export", () => {
  Object.assign(globalThis, { window: globalThis });
  afterEach(() => {
    clearMocks();
  });

  const project = { flows: {} } as unknown as Project;

  /** Sends a message through the channel that a command received, as Rust would. */
  function send(events: unknown, index: number, message: RunEvent): void {
    const id = (events as { id: number }).id;
    const internals = (
      globalThis as unknown as {
        __TAURI_INTERNALS__: { runCallback(id: number, data: unknown): void };
      }
    ).__TAURI_INTERNALS__;
    internals.runCallback(id, { index, message });
  }

  it.effect("calls each command by its name with its arguments", () =>
    Effect.gen(function* () {
      const calls: { cmd: string; args: unknown }[] = [];
      mockIPC((cmd, args) => {
        calls.push({ cmd, args });
        switch (cmd) {
          case "start_bot":
            return { outcome: "started" };
          case "stop_bot":
            return "stopped";
          case "token_status":
            return { token_set: true, dev_guild: "42" };
          case "export_bot":
            return { outcome: "exported", path: "/out", assets: 0 };
          default:
            return null;
        }
      });
      const backend = yield* TauriBackend;
      expect(yield* backend.startBot(project, () => undefined)).toEqual({
        outcome: "started",
      });
      expect(yield* backend.stopBot()).toBe("stopped");
      yield* backend.setToken("abc.def");
      expect(yield* backend.tokenStatus()).toEqual({
        token_set: true,
        dev_guild: "42",
      });
      yield* backend.setDevGuild("42");
      yield* backend.setDevGuild(null);
      expect(yield* backend.exportBot(project, "my-bot")).toEqual({
        outcome: "exported",
        path: "/out",
        assets: 0,
      });
      expect(calls.map((c) => c.cmd)).toEqual([
        "start_bot",
        "stop_bot",
        "set_token",
        "token_status",
        "set_dev_guild",
        "set_dev_guild",
        "export_bot",
      ]);
      expect(calls[0]?.args).toMatchObject({ project });
      expect(calls[2]?.args).toEqual({ token: "abc.def" });
      expect(calls[4]?.args).toEqual({ guild: "42" });
      expect(calls[5]?.args).toEqual({ guild: null });
      expect(calls[6]?.args).toEqual({ project, name: "my-bot" });
    }).pipe(Effect.provide(TauriBackend.layer)),
  );

  it.effect("gives the events of the channel in the order they were sent", () =>
    Effect.gen(function* () {
      const seen: RunEvent[] = [];
      const log = (msg: string): RunEvent => ({
        kind: "log",
        data: {
          ts: null,
          level: "info",
          source: "engine",
          run: null,
          flow: null,
          node: null,
          msg,
        },
      });
      mockIPC((cmd, args) => {
        if (cmd === "start_bot") {
          const events = (args as { events: unknown }).events;
          // Delivered out of order on purpose: the channel puts them back in order.
          send(events, 2, log("third"));
          send(events, 0, { kind: "status", data: { state: "starting" } });
          send(events, 1, log("second"));
          return { outcome: "started" };
        }
        return null;
      });
      const backend = yield* TauriBackend;
      yield* backend.startBot(project, (event) => seen.push(event));
      expect(seen).toEqual([
        { kind: "status", data: { state: "starting" } },
        log("second"),
        log("third"),
      ]);
    }).pipe(Effect.provide(TauriBackend.layer)),
  );

  it.effect("keeps the error of Rust, and the token is in no error", () =>
    Effect.gen(function* () {
      mockIPC(() =>
        // Tauri rejects with the serialized error as it is, not with an `Error`.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject({ kind: "invalid_input", message: "bad token" }),
      );
      const backend = yield* TauriBackend;
      const error = yield* Effect.flip(backend.setToken("MARKER.secret"));
      expect(error.cause).toEqual({
        kind: "invalid_input",
        message: "bad token",
      });
      expect(JSON.stringify(error.cause)).not.toContain("MARKER");
      const started = yield* Effect.flip(
        backend.startBot(project, () => undefined),
      );
      expect(started.command).toBe("start_bot");
    }).pipe(Effect.provide(TauriBackend.layer)),
  );
});
