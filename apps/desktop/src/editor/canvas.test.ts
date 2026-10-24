import { describe, expect, it } from "vitest";
import { edgeId, lineOfEdge, toFlowEdges, toFlowNodes } from "./canvas";
import { catalog, ping } from "./fixtures";

describe("toFlowNodes", () => {
  it("draws every node at its saved position with the ports of its schema", () => {
    const nodes = toFlowNodes(ping, catalog);
    expect(nodes.map((n) => [n.id, n.position])).toEqual([
      ["n1", { x: 0, y: 0 }],
      ["n2", { x: 280, y: 0 }],
    ]);
    expect(nodes[0]?.data).toMatchObject({
      alias: "ping_command",
      ports: ["next"],
      isTrigger: true,
      known: true,
    });
    expect(nodes[1]?.data.ports).toEqual(["next", "error"]);
    expect(nodes[1]?.data.isTrigger).toBe(false);
  });

  it("keeps the selection", () => {
    const nodes = toFlowNodes(ping, catalog, new Set(["n2"]));
    expect(nodes.map((n) => n.selected)).toEqual([false, true]);
  });

  it("draws a node of an unknown type without ports", () => {
    const nodes = toFlowNodes(ping, []);
    expect(nodes[0]?.data).toMatchObject({ ports: [], known: false });
  });
});

describe("edges", () => {
  it("draws a line from its port and gives it back", () => {
    const edges = toFlowEdges(ping);
    expect(edges).toHaveLength(1);
    const [edge] = edges;
    expect(edge).toMatchObject({
      id: "n1:next->n2",
      source: "n1",
      sourceHandle: "next",
      target: "n2",
    });
    const line = ping.lines[0];
    expect(line && edgeId(line)).toBe(edge?.id);
    expect(edge && lineOfEdge(edge)).toEqual(line);
  });

  it("has no line for an edge without a source handle", () => {
    expect(lineOfEdge({ id: "e", source: "a", target: "b" })).toBeUndefined();
  });

  it("two ports of one node to one target have different ids", () => {
    const a = edgeId({ from: { node: "n", port: "true" }, to: "t" });
    const b = edgeId({ from: { node: "n", port: "false" }, to: "t" });
    expect(a).not.toBe(b);
  });
});
