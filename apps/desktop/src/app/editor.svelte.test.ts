import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { catalog, ping, reply } from "../editor/fixtures";
import type { OpenedProject, Project } from "../lib/bindings";
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
    store.moveNode("n1", { x: 9, y: 9 });
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
    store.moveNode("n1", { x: 5, y: 5 });
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
