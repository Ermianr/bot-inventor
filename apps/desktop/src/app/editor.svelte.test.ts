import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { catalog, ping, reply } from "../editor/fixtures";
import type { DiagnosticView, OpenedProject, Project } from "../lib/bindings";
import {
  BackendError,
  TauriBackend,
  type Backend,
} from "../services/TauriBackend";
import { EditorStore } from "./editor.svelte";

const info = { name: "Bot Inventor", version: "0.0.0" };

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

function setup(overrides: Partial<Backend> = {}) {
  const saved: Project[] = [];
  const backend: Partial<Backend> = {
    nodeCatalog: () => Effect.succeed([...catalog]),
    openProject: () =>
      Effect.succeed({ project, migrated_from: null } satisfies OpenedProject),
    saveProject: (p) =>
      Effect.sync(() => {
        saved.push(p);
      }),
    ...overrides,
  };
  const store = new EditorStore(
    ManagedRuntime.make(TauriBackend.layerTest(info, backend)),
    0,
  );
  return { store, saved };
}

async function opened(overrides: Partial<Backend> = {}) {
  const made = setup(overrides);
  made.store.openProject();
  await vi.waitFor(() => {
    expect(made.store.project).not.toBeNull();
  });
  return made;
}

describe("EditorStore", () => {
  it("opens a project on its first flow, with nothing to save", async () => {
    const { store } = await opened();
    expect(store.flowName).toBe("ping");
    expect(store.flow).toBe(ping);
    expect(store.dirty).toBe(false);
    expect(store.notice).toBeNull();
  });

  it("says when the project was migrated", async () => {
    const { store } = await opened({
      openProject: () =>
        Effect.succeed({ project, migrated_from: 1 } satisfies OpenedProject),
    });
    expect(store.notice).toMatchObject({ kind: "info" });
  });

  it("leaves everything as it was when the person cancels the dialog", async () => {
    const { store } = setup({ openProject: () => Effect.succeed(null) });
    store.openProject();
    await vi.waitFor(() => {
      expect(store.busy).toBe(false);
    });
    expect(store.project).toBeNull();
    expect(store.notice).toBeNull();
  });

  it("shows the message Rust gave when opening fails", async () => {
    const { store } = setup({
      openProject: () =>
        Effect.fail(
          new BackendError({
            command: "open_project",
            cause: { kind: "project", message: "bot.botproj not found" },
          }),
        ),
    });
    store.openProject();
    await vi.waitFor(() => {
      expect(store.notice).toEqual({
        kind: "error",
        text: "bot.botproj not found",
      });
    });
    expect(store.project).toBeNull();
    expect(store.busy).toBe(false);
  });

  it("marks an edit as unsaved and saving clears it", async () => {
    const { store, saved } = await opened();
    store.addNodeAt(catalog[1] ?? reply, { x: 1, y: 2 });
    expect(store.dirty).toBe(true);
    expect(store.flow?.nodes).toHaveLength(3);

    store.save();
    await vi.waitFor(() => {
      expect(store.dirty).toBe(false);
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.flows.ping?.nodes).toHaveLength(3);
  });

  it("keeps an edit made while saving marked as unsaved", async () => {
    let finish = (): void => undefined;
    const { store } = await opened({
      saveProject: () =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        ),
    });
    store.addNodeAt(reply, { x: 0, y: 0 });
    store.save();
    await vi.waitFor(() => {
      expect(store.busy).toBe(true);
    });
    store.moveNodes([{ id: "n1", position: { x: 9, y: 9 } }]);
    finish();
    await vi.waitFor(() => {
      expect(store.busy).toBe(false);
    });
    expect(store.dirty).toBe(true);
  });

  it("does not open another project over unsaved changes", async () => {
    const openProject = vi.fn(() =>
      Effect.succeed({ project, migrated_from: null } satisfies OpenedProject),
    );
    const { store } = await opened({ openProject });
    store.moveNodes([{ id: "n1", position: { x: 5, y: 5 } }]);
    store.openProject();
    expect(openProject).toHaveBeenCalledTimes(1);
    expect(store.notice).toMatchObject({ kind: "error" });
    store.newProject("other");
    expect(store.notice).toMatchObject({ kind: "error" });
  });

  it("refuses a line the canvas cannot draw and draws the model again", async () => {
    const { store } = await opened({
      nodeCatalog: () => Effect.succeed([...catalog]),
    });
    store.loadCatalog();
    await vi.waitFor(() => {
      expect(store.catalog).toHaveLength(3);
    });
    const before = store.revision;
    expect(store.connect({ node: "n2", port: "next" }, "n1")).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.project?.flows.ping).toBe(ping);
    expect(store.revision).toBeGreaterThan(before);
  });

  it("deletes a node together with its lines", async () => {
    const { store } = await opened();
    store.remove(new Set(["n2"]), []);
    expect(store.flow?.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(store.flow?.lines).toEqual([]);
    expect(store.dirty).toBe(true);
  });

  it("creates a flow and shows it", async () => {
    const { store } = await opened();
    store.createFlow();
    expect(store.flowNames).toEqual(["ping", "flow"]);
    expect(store.flowName).toBe("flow");
    expect(store.dirty).toBe(true);
    store.selectFlow("nope");
    expect(store.flowName).toBe("flow");
  });

  it("does nothing to a project that is not open", () => {
    const { store } = setup();
    store.addNodeAt(reply, { x: 0, y: 0 });
    store.createFlow();
    store.save();
    expect(store.project).toBeNull();
    expect(store.dirty).toBe(false);
  });
});

describe("EditorStore history", () => {
  const second = catalog[1] ?? reply;

  it("undoes and redoes an edit, and says so", async () => {
    const { store } = await opened();
    expect(store.canUndo).toBe(false);
    store.addNodeAt(second, { x: 0, y: 0 });
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.flow).toBe(ping);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.flow?.nodes).toHaveLength(3);
    expect(store.canRedo).toBe(false);
  });

  it("is Saved again when an undo goes back to the saved project", async () => {
    const { store } = await opened();
    store.addNodeAt(second, { x: 0, y: 0 });
    expect(store.dirty).toBe(true);
    store.undo();
    expect(store.dirty).toBe(false);
    store.redo();
    expect(store.dirty).toBe(true);
  });

  it("compares the project by value, so the same edit made twice is clean", async () => {
    const { store } = await opened();
    store.setSetting("n2", "content", "Changed");
    expect(store.dirty).toBe(true);
    store.setSetting("n2", "content", "Pong!");
    expect(store.dirty).toBe(false);
  });

  it("keeps the history after a save, and Saved follows the saved project", async () => {
    const { store } = await opened();
    store.addNodeAt(second, { x: 0, y: 0 });
    store.save();
    await vi.waitFor(() => {
      expect(store.dirty).toBe(false);
    });
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.dirty).toBe(true);
    store.redo();
    expect(store.dirty).toBe(false);
  });

  it("makes typing in one field one step, and another field another", async () => {
    const { store } = await opened();
    for (const text of ["P", "Po", "Pon", "Pong", "Pong!!"]) {
      store.setSetting("n2", "content", text);
    }
    expect(store.setting("n2", "content")).toBe("Pong!!");
    store.setSetting("n1", "name", "pong");
    store.undo();
    expect(store.setting("n1", "name")).toBe("ping");
    expect(store.setting("n2", "content")).toBe("Pong!!");
    store.undo();
    expect(store.setting("n2", "content")).toBe("Pong!");
    expect(store.canUndo).toBe(false);
  });

  it("starts a new step when the selection changes in between", async () => {
    const { store } = await opened();
    store.setSetting("n2", "content", "A");
    store.setSelection(["n1"]);
    store.setSelection(["n2"]);
    store.setSetting("n2", "content", "AB");
    store.undo();
    expect(store.setting("n2", "content")).toBe("A");
  });

  it("makes one drag of several nodes one step", async () => {
    const { store } = await opened();
    store.moveNodes([
      { id: "n1", position: { x: 1, y: 1 } },
      { id: "n2", position: { x: 2, y: 2 } },
    ]);
    store.undo();
    expect(store.flow).toBe(ping);
  });

  it("makes a rename a step, and refuses a bad alias without a step", async () => {
    const { store } = await opened();
    expect(store.renameAlias("n2", "answer")).toBeNull();
    expect(store.renameAlias("n2", "Bad Name")).toBe("invalid");
    expect(store.renameAlias("n2", "ping_command")).toBe("taken");
    expect(store.flow?.nodes[1]?.alias).toBe("answer");
    store.undo();
    expect(store.flow?.nodes[1]?.alias).toBe("reply");
    expect(store.canUndo).toBe(false);
  });

  it("edits the rows of a list", async () => {
    const { store } = await opened();
    const field = { max: 2, item: [] };
    store.addListRow("n1", "options", field);
    store.addListRow("n1", "options", field);
    store.addListRow("n1", "options", field);
    expect(store.setting("n1", "options")).toEqual([{}, {}]);
    store.removeListRow("n1", "options", 0, false);
    store.removeListRow("n1", "options", 0, false);
    expect(store.setting("n1", "options")).toBeUndefined();
  });

  it("shows the flow that the step touched, and the first when it is gone", async () => {
    const { store } = await opened();
    store.createFlow();
    expect(store.flowName).toBe("flow");
    store.selectFlow("ping");
    store.addNodeAt(second, { x: 0, y: 0 });
    store.selectFlow("flow");
    store.undo();
    expect(store.flowName).toBe("ping");
    store.undo();
    // The flow that was created is gone; the first one is shown.
    expect(store.flowNames).toEqual(["ping"]);
    expect(store.flowName).toBe("ping");
    store.redo();
    expect(store.flowNames).toEqual(["ping", "flow"]);
    expect(store.flowName).toBe("flow");
    store.redo();
    expect(store.flowName).toBe("ping");
    expect(store.flow?.nodes).toHaveLength(3);
  });

  it("starts with an empty history for each project it opens", async () => {
    const { store } = await opened();
    store.addNodeAt(second, { x: 0, y: 0 });
    store.save();
    await vi.waitFor(() => {
      expect(store.dirty).toBe(false);
    });
    store.openProject();
    await vi.waitFor(() => {
      expect(store.canUndo).toBe(false);
    });
    expect(store.canRedo).toBe(false);
  });
});

describe("EditorStore diagnostics", () => {
  const problem: DiagnosticView = {
    flow: "ping",
    node: "n2",
    path: "content",
    code: "missing-field",
    severity: "error",
    message: "`content` is required",
  };

  it("validates a project when it is opened", async () => {
    const { store } = await opened({
      validateProject: () => Effect.succeed([problem]),
    });
    await vi.waitFor(() => {
      expect(store.diagnostics).toEqual([problem]);
    });
  });

  it("validates again after a change, with the project as it is then", async () => {
    const asked: Project[] = [];
    const { store } = await opened({
      validateProject: (p) =>
        Effect.sync(() => {
          asked.push(p);
          return [];
        }),
    });
    await vi.waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    store.setSetting("n2", "content", "x");
    store.setSetting("n2", "content", "xy");
    await vi.waitFor(() => {
      expect(asked.length).toBeGreaterThan(1);
    });
    expect(asked.at(-1)?.flows.ping?.nodes[1]?.settings).toEqual({
      content: "xy",
    });
  });

  it("drops the answer about a project that has changed", async () => {
    const answers: ((list: DiagnosticView[]) => void)[] = [];
    const { store } = await opened({
      validateProject: () =>
        Effect.promise(
          () =>
            new Promise<DiagnosticView[]>((resolve) => {
              answers.push(resolve);
            }),
        ),
    });
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    store.setSetting("n2", "content", "new");
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    // The first answer comes last and is about the project before the change.
    answers[1]?.([]);
    await vi.waitFor(() => {
      expect(store.diagnostics).toEqual([]);
    });
    answers[0]?.([problem]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.diagnostics).toEqual([]);
  });

  it("keeps what it had when the backend cannot validate", async () => {
    const { store } = await opened({
      validateProject: () =>
        Effect.fail(
          new BackendError({ command: "validate_project", cause: "x" }),
        ),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.diagnostics).toEqual([]);
    expect(store.notice).toBeNull();
  });
});

describe("Ping from scratch", () => {
  it("built with the edit functions of the editor, is the flow of the sample", async () => {
    const { store } = setup({
      openProject: () =>
        Effect.succeed({
          project: { ...project, flows: { main: { nodes: [], lines: [] } } },
          migrated_from: null,
        } satisfies OpenedProject),
      nodeCatalog: () => Effect.succeed([...catalog]),
    });
    store.loadCatalog();
    store.openProject();
    await vi.waitFor(() => {
      expect(store.project).not.toBeNull();
      expect(store.catalog).toHaveLength(3);
    });
    const [trigger, answer] = catalog;
    if (trigger === undefined || answer === undefined)
      throw new Error("fixture");
    store.addNodeAt(trigger, { x: 0, y: 0 });
    store.addNodeAt(answer, { x: 280, y: 0 });
    const [first, second] = store.flow?.nodes ?? [];
    if (first === undefined || second === undefined)
      throw new Error("two nodes");
    store.setSetting(first.id, "name", "ping");
    store.setSetting(first.id, "ephemeral", false);
    store.setSetting(second.id, "content", "Pong!");
    expect(store.connect({ node: first.id, port: "next" }, second.id)).toBe(
      true,
    );

    const built = store.flow;
    expect(
      built?.nodes.map((n) => [n.type, n.type_version, n.settings]),
    ).toEqual(ping.nodes.map((n) => [n.type, n.type_version, n.settings]));
    expect(built?.lines).toEqual([
      { from: { node: first.id, port: "next" }, to: second.id },
    ]);
  });
});
