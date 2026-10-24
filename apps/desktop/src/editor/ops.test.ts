import { describe, expect, it } from "vitest";
import type { Flow } from "../lib/bindings";
import { catalog, ping, reply, trigger, branch } from "./fixtures";
import {
  addFlow,
  addLine,
  addNode,
  defaultSettings,
  findSpec,
  moveNode,
  removeLines,
  removeNodes,
  withFlow,
} from "./ops";

const empty: Flow = { nodes: [], lines: [] };

describe("addNode", () => {
  it("adds a node with its own id and alias and the version of the schema", () => {
    const { flow, id } = addNode(ping, reply, { x: 10, y: 20 });
    expect(flow.nodes).toHaveLength(3);
    const added = flow.nodes.find((n) => n.id === id);
    expect(added).toMatchObject({
      alias: "reply_2",
      type: "discord.reply",
      type_version: 1,
      editor: { x: 10, y: 20 },
    });
    expect(new Set(flow.nodes.map((n) => n.id)).size).toBe(3);
  });

  it("does not change the flow it was given", () => {
    const before = structuredClone(ping);
    addNode(ping, reply, { x: 0, y: 0 });
    expect(ping).toEqual(before);
  });

  it("makes ids and aliases that never collide, however many are added", () => {
    let flow = empty;
    for (let i = 0; i < 200; i++) {
      flow = addNode(flow, reply, { x: i, y: 0 }).flow;
    }
    expect(new Set(flow.nodes.map((n) => n.id)).size).toBe(200);
    expect(new Set(flow.nodes.map((n) => n.alias)).size).toBe(200);
  });

  it("starts a node with the settings a required field can have by itself", () => {
    expect(defaultSettings(branch)).toEqual({ mode: "all", items: [] });
    expect(defaultSettings(trigger)).toEqual({ ephemeral: false });
    expect(defaultSettings(reply)).toEqual({});
  });
});

describe("removeNodes", () => {
  it("removes the lines of the node too", () => {
    const flow = removeNodes(ping, new Set(["n2"]));
    expect(flow.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(flow.lines).toEqual([]);
  });

  it("ignores an id that is not there", () => {
    expect(removeNodes(ping, new Set(["zz"]))).toEqual(ping);
  });
});

describe("addLine", () => {
  const two = addNode(ping, reply, { x: 560, y: 0 });
  const third = two.id;

  it("joins an output port to a node", () => {
    const result = addLine(
      two.flow,
      catalog,
      { node: "n2", port: "next" },
      third,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.flow.lines).toHaveLength(2);
    }
  });

  it("refuses what the canvas cannot draw", () => {
    const cases: [string, Parameters<typeof addLine>[2], string][] = [
      ["unknown-node", { node: "zz", port: "next" }, "n2"],
      ["unknown-node", { node: "n1", port: "next" }, "zz"],
      ["unknown-port", { node: "n1", port: "true" }, "n2"],
      ["into-trigger", { node: "n2", port: "next" }, "n1"],
      ["duplicate-line", { node: "n1", port: "next" }, "n2"],
    ];
    for (const [error, from, to] of cases) {
      const result = addLine(ping, catalog, from, to);
      expect(result, error).toEqual({ ok: false, error });
    }
  });

  it("refuses a port of a node whose type is not in the catalog", () => {
    const unknown: Flow = {
      nodes: [
        ...ping.nodes,
        {
          id: "n9",
          alias: "mystery",
          type: "other.mystery",
          type_version: 1,
          settings: {},
          editor: { x: 0, y: 0 },
        },
      ],
      lines: [],
    };
    expect(
      addLine(unknown, catalog, { node: "n9", port: "next" }, "n2"),
    ).toEqual({
      ok: false,
      error: "unknown-port",
    });
  });
});

describe("removeLines", () => {
  it("removes the lines the predicate picks", () => {
    expect(removeLines(ping, (l) => l.to === "n2").lines).toEqual([]);
    expect(removeLines(ping, () => false)).toEqual(ping);
  });
});

describe("moveNode", () => {
  it("moves one node", () => {
    const flow = moveNode(ping, "n2", { x: 5, y: 6 });
    expect(flow.nodes[1]?.editor).toEqual({ x: 5, y: 6 });
    expect(flow.nodes[0]).toBe(ping.nodes[0]);
  });

  it("ignores a position that is not a finite number", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(moveNode(ping, "n1", { x: bad, y: 0 })).toBe(ping);
      expect(moveNode(ping, "n1", { x: 0, y: bad })).toBe(ping);
    }
  });
});

describe("flows of a project", () => {
  const project = {
    manifest: {
      format_version: 1,
      name: "bot",
      platform: "discord" as const,
      settings: {},
      variables: [],
    },
    flows: { ping },
  };

  it("adds an empty flow and keeps the others", () => {
    const next = addFlow(project, "welcome");
    expect(Object.keys(next.flows).sort()).toEqual(["ping", "welcome"]);
    expect(next.flows.welcome).toEqual(empty);
    expect(next.flows.ping).toBe(ping);
  });

  it("does not replace a flow that exists", () => {
    expect(addFlow(project, "ping")).toBe(project);
  });

  it("replaces a flow", () => {
    expect(withFlow(project, "ping", empty).flows.ping).toEqual(empty);
  });
});

describe("findSpec", () => {
  it("needs the type and the version", () => {
    expect(findSpec(catalog, "discord.reply", 1)).toBe(reply);
    expect(findSpec(catalog, "discord.reply", 2)).toBeUndefined();
    expect(findSpec(catalog, "nope", 1)).toBeUndefined();
  });
});
