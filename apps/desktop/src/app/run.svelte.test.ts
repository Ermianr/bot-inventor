import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ping } from "../editor/fixtures";
import type {
  DiagnosticView,
  LogLine,
  OpenedProject,
  Project,
  RunEvent,
  RunStatus,
  StartOutcome,
  StopResult,
} from "../lib/bindings";
import {
  BackendError,
  TauriBackend,
  type Backend,
} from "../services/TauriBackend";
import { EditorStore } from "./editor.svelte";
import { describeExit } from "./exit";
import { RunStore } from "./run.svelte";

const info = { name: "Bot Inventor", version: "0.0.0" };
const MARKER = "MARKER-token.AbC_123-xyz";

const project: Project = {
  manifest: {
    format_version: 1,
    name: "bot",
    platform: "discord",
    settings: {},
    variables: [],
  },
  flows: { ping },
};

const status = (s: RunStatus): RunEvent => ({ kind: "status", data: s });
const exited = (over: Partial<Extract<RunStatus, { state: "exited" }>> = {}) =>
  status({
    state: "exited",
    code: 0,
    signal: null,
    reason: "clean",
    requested: false,
    ...over,
  });

function line(msg: string, over: Partial<LogLine> = {}): RunEvent {
  return {
    kind: "log",
    data: {
      ts: "2026-10-24T10:00:00.000Z",
      level: "info",
      source: "engine",
      run: null,
      flow: null,
      node: null,
      msg,
      ...over,
    },
  };
}

function rustError(kind: string, message: string): BackendError {
  return new BackendError({ command: "x", cause: { kind, message } });
}

const error = (count = 1): DiagnosticView[] =>
  Array.from({ length: count }, () => ({
    flow: "ping",
    node: "n1",
    path: "content",
    code: "missing-field",
    severity: "error" as const,
    message: "`content` is required",
  }));

/** An editor with a project open and a run store over the same fake backend. */
async function setup(
  overrides: Partial<Backend> = {},
  flushDelay = 0,
  open = true,
) {
  const calls: string[] = [];
  let send: (event: RunEvent) => void = () => undefined;
  const backend: Partial<Backend> = {
    nodeCatalog: () => Effect.succeed([]),
    openProject: () =>
      Effect.succeed({ project, migrated_from: null } satisfies OpenedProject),
    validateProject: () =>
      Effect.sync(() => {
        calls.push("validate");
        return [];
      }),
    startBot: (_project, onEvent) =>
      Effect.sync(() => {
        calls.push("start");
        send = onEvent;
        return { outcome: "started" } satisfies StartOutcome;
      }),
    stopBot: () =>
      Effect.sync(() => {
        calls.push("stop");
        return "stopped" satisfies StopResult;
      }),
    ...overrides,
  };
  const rt = ManagedRuntime.make(TauriBackend.layerTest(info, backend));
  const editor = new EditorStore(rt, 0);
  const run = new RunStore(rt, editor, flushDelay);
  if (open) {
    editor.openProject();
    await vi.waitFor(() => {
      expect(editor.project).not.toBeNull();
    });
  }
  return { editor, run, calls, emit: (e: RunEvent) => send(e) };
}

describe("RunStore", () => {
  it("follows the bot from starting to its exit and locks the project meanwhile", async () => {
    const { editor, run, emit } = await setup();
    expect(run.phase).toBe("idle");
    expect(run.blocker).toBeNull();

    run.start();
    expect(run.phase).toBe("starting");
    expect(editor.locked).toBe(true);
    await vi.waitFor(() => {
      expect(run.blocker).toBe("running");
    });
    emit(status({ state: "starting" }));
    emit(status({ state: "running" }));
    emit(line("one"));
    emit(line("two"));
    expect(run.phase).toBe("running");
    expect(run.canStop).toBe(true);
    await vi.waitFor(() => {
      expect(run.log.entries.map((e) => e.line.msg)).toEqual(["one", "two"]);
    });

    emit(status({ state: "stopping" }));
    expect(run.phase).toBe("stopping");
    expect(run.canStop).toBe(false);
    emit(exited({ requested: true }));
    expect(run.phase).toBe("exited");
    expect(editor.locked).toBe(false);
    expect(run.exit).toMatchObject({ reason: "clean", requested: true });
    expect(run.blocker).toBeNull();
  });

  it("opens the log panel when the bot starts, and the person may close it", async () => {
    const { run, emit } = await setup();
    expect(run.logOpen).toBe(false);
    run.start();
    expect(run.logOpen).toBe(true);
    run.logOpen = false;
    emit(line("still arriving"));
    await vi.waitFor(() => {
      expect(run.log.entries).toHaveLength(1);
    });
    expect(run.logOpen).toBe(false);
  });

  it("does not run without a project, or with an error in the project", async () => {
    const { editor, run, calls } = await setup();
    editor.diagnostics = error(2);
    expect(run.blocker).toBe("errors");
    run.start();
    expect(run.phase).toBe("idle");
    expect(calls).not.toContain("start");

    editor.diagnostics = [{ ...error()[0]!, severity: "warning" }];
    expect(run.blocker).toBeNull();

    const none = await setup({}, 0, false);
    expect(none.run.blocker).toBe("no-project");
    none.run.start();
    expect(none.run.phase).toBe("idle");
    expect(none.calls).not.toContain("start");
  });

  it("starts once however many times it is clicked", async () => {
    const { run, calls } = await setup();
    run.start();
    run.start();
    run.start();
    await vi.waitFor(() => {
      expect(calls.filter((c) => c === "start")).toHaveLength(1);
    });
  });

  it("goes back to idle, unlocked, with Rust's message when the start fails", async () => {
    const { editor, run } = await setup({
      startBot: () =>
        Effect.fail(rustError("spawn", "cannot start the runner (NotFound)")),
    });
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("idle");
    });
    expect(editor.locked).toBe(false);
    expect(editor.notice).toEqual({
      kind: "error",
      text: "cannot start the runner (NotFound)",
    });
  });

  it("explains a project that Rust finds invalid, and validates again", async () => {
    const { editor, run, calls } = await setup({
      startBot: () =>
        Effect.succeed({ outcome: "invalid", diagnostics: error(3) }),
    });
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("idle");
    });
    expect(editor.locked).toBe(false);
    expect(editor.notice?.kind).toBe("error");
    expect(editor.notice?.text).toContain("3");
    await vi.waitFor(() => {
      expect(calls.filter((c) => c === "validate").length).toBeGreaterThan(1);
    });
  });

  it("keeps an exit that arrives before the start call answers", async () => {
    const { run, editor } = await setup({
      startBot: (_p, onEvent) =>
        Effect.sync(() => {
          onEvent(status({ state: "starting" }));
          onEvent(line("error: no .env", { level: "error" }));
          onEvent(
            exited({ code: 2, reason: "configuration", requested: false }),
          );
          return { outcome: "started" } satisfies StartOutcome;
        }),
    });
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("exited");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run.phase).toBe("exited");
    expect(editor.locked).toBe(false);
    expect(run.log.entries.map((e) => e.line.msg)).toEqual(["error: no .env"]);
    expect(run.exit?.code).toBe(2);
  });

  it("stops the bot, and does nothing when none runs", async () => {
    const { run, calls, emit } = await setup();
    run.stop();
    expect(calls).not.toContain("stop");

    run.start();
    await vi.waitFor(() => {
      expect(calls).toContain("start");
    });
    emit(status({ state: "running" }));
    run.stop();
    await vi.waitFor(() => {
      expect(calls).toContain("stop");
    });
  });

  it("does not wait for an exit that nothing will report", async () => {
    const { run, editor, emit } = await setup({
      stopBot: () => Effect.succeed("not_running"),
    });
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("starting");
    });
    emit(status({ state: "running" }));
    run.stop();
    await vi.waitFor(() => {
      expect(run.phase).toBe("idle");
    });
    expect(editor.locked).toBe(false);
  });

  it("shows the message of a stop that fails", async () => {
    const { run, editor, emit } = await setup({
      stopBot: () => Effect.fail(rustError("no_project", "")),
    });
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("starting");
    });
    emit(status({ state: "running" }));
    run.stop();
    await vi.waitFor(() => {
      expect(editor.notice?.kind).toBe("error");
    });
    expect(run.phase).toBe("running");
  });

  it("keeps every line in order through a burst, with the lines before an exit shown first", async () => {
    const { run, emit } = await setup({}, 5);
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("starting");
    });
    for (let i = 0; i < 3000; i++) emit(line(String(i)));
    emit(exited());
    // The exit flushed what was waiting.
    expect(run.log.entries).toHaveLength(3000);
    expect(run.log.entries.map((e) => e.line.msg)).toEqual(
      Array.from({ length: 3000 }, (_, i) => String(i)),
    );
  });

  it("clears the log, and a new run starts with an empty one", async () => {
    const { run, emit } = await setup();
    run.start();
    await vi.waitFor(() => {
      expect(run.phase).toBe("starting");
    });
    emit(line("a"));
    await vi.waitFor(() => {
      expect(run.log.entries).toHaveLength(1);
    });
    run.clear();
    expect(run.log.entries).toEqual([]);
    emit(line("b"));
    await vi.waitFor(() => {
      expect(run.log.entries.map((e) => e.line.msg)).toEqual(["b"]);
    });
    emit(exited());
    run.start();
    expect(run.log.entries).toEqual([]);
    expect(run.exit).toBeNull();
  });

  it("does not let the project be replaced while the bot runs", async () => {
    const other: OpenedProject = {
      project: {
        ...project,
        manifest: { ...project.manifest, name: "other" },
      },
      migrated_from: null,
    };
    const { editor, run, calls } = await setup({
      newProject: () => Effect.succeed(other),
    });
    run.start();
    await vi.waitFor(() => {
      expect(calls).toContain("start");
    });
    editor.newProject("other");
    expect(editor.notice?.kind).toBe("error");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editor.project?.manifest.name).toBe("bot");
  });
});

describe("the token and the settings", () => {
  it("reads whether a token is set when asked, and after saving one", async () => {
    let set = false;
    const { run } = await setup({
      tokenStatus: () => Effect.succeed({ token_set: set, dev_guild: "42" }),
      setToken: () =>
        Effect.sync(() => {
          set = true;
        }),
    });
    run.loadSettings();
    await vi.waitFor(() => {
      expect(run.settings).toEqual({ token_set: false, dev_guild: "42" });
    });
    expect(await run.saveToken(MARKER)).toEqual({ ok: true, value: null });
    await vi.waitFor(() => {
      expect(run.settings?.token_set).toBe(true);
    });
  });

  it("holds the token nowhere, with a save that works and one that fails", async () => {
    for (const fails of [false, true]) {
      const { editor, run } = await setup({
        setToken: () =>
          fails
            ? Effect.fail(rustError("invalid_input", "the token is not valid"))
            : Effect.void,
      });
      const reply = await run.saveToken(MARKER);
      expect(reply.ok).toBe(!fails);
      if (!reply.ok) expect(reply.message).toBe("the token is not valid");
      await new Promise((resolve) => setTimeout(resolve, 10));

      const everything = JSON.stringify([
        Object.entries(run),
        Object.entries(editor),
        run.settings,
        run.log,
        editor.notice,
        reply,
      ]);
      expect(everything).not.toContain(MARKER);
    }
  });

  it("keeps Rust's message when the development server is refused", async () => {
    const { run } = await setup({
      setDevGuild: (guild) =>
        guild === "x"
          ? Effect.fail(rustError("invalid_input", "the server id must..."))
          : Effect.void,
    });
    expect(await run.saveDevGuild("x")).toEqual({
      ok: false,
      message: "the server id must...",
    });
    expect(await run.saveDevGuild(null)).toEqual({ ok: true, value: null });
  });

  it("knows no settings without a project", async () => {
    const { run } = await setup({}, 0, false);
    run.loadSettings();
    expect(run.settings).toBeNull();
  });
});

describe("export", () => {
  it("tells where the bot was written, and is silent when the person cancels", async () => {
    const { run, editor } = await setup({
      exportBot: (_p, name) =>
        Effect.succeed(
          name === "cancel"
            ? null
            : { outcome: "exported", path: "/out/bot", assets: 0 },
        ),
    });
    expect(await run.exportBot("cancel")).toEqual({ kind: "cancelled" });
    expect(editor.notice).toBeNull();
    expect(await run.exportBot("my-bot")).toEqual({
      kind: "exported",
      path: "/out/bot",
    });
    expect(editor.notice?.kind).toBe("info");
    expect(editor.notice?.text).toContain("/out/bot");
    expect(editor.notice?.text).toContain(".env.example");
    expect(run.exporting).toBe(false);
  });

  it("returns the message of a refused name and writes no notice", async () => {
    const { run, editor } = await setup({
      exportBot: () => Effect.fail(rustError("invalid_input", "bad name")),
    });
    expect(await run.exportBot("../x")).toEqual({
      kind: "failed",
      message: "bad name",
    });
    expect(editor.notice).toBeNull();
  });

  it("explains a project with errors and validates again", async () => {
    const { run, editor, calls } = await setup({
      exportBot: () =>
        Effect.succeed({ outcome: "invalid", diagnostics: error(2) }),
    });
    expect(await run.exportBot("bot")).toEqual({ kind: "invalid" });
    expect(editor.notice?.text).toContain("2");
    await vi.waitFor(() => {
      expect(calls.filter((c) => c === "validate").length).toBeGreaterThan(1);
    });
  });
});

describe("describeExit", () => {
  const exit = (over: Partial<Extract<RunStatus, { state: "exited" }>>) => ({
    state: "exited" as const,
    code: 0,
    signal: null,
    reason: "clean" as const,
    requested: false,
    ...over,
  });

  it("says what happened in words, and when nobody asked for it", () => {
    expect(describeExit(exit({ requested: true }))).toBe("Stopped");
    expect(
      describeExit(exit({ requested: true, reason: "signal", code: null })),
    ).toContain("killed");
    expect(describeExit(exit({ code: 2, reason: "configuration" }))).toContain(
      "Stopped unexpectedly: Configuration problem (exit code 2)",
    );
    expect(describeExit(exit({ code: 1, reason: "failure" }))).toContain(
      "exit code 1",
    );
    expect(
      describeExit(exit({ code: 3, reason: "payload_version" })),
    ).toContain("Payload version");
    expect(
      describeExit(exit({ code: null, signal: 9, reason: "signal" })),
    ).toContain("signal 9");
    expect(describeExit(exit({}))).toContain("unexpectedly");
  });
});
