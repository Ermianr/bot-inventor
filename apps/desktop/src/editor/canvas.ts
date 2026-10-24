/** The conversion between a flow of the project and what Svelte Flow draws. */

import type { Edge, Node } from "@xyflow/svelte";
import type { Flow, Line, NodeSpec } from "../lib/bindings";
import { NO_MARKS, hasError, ofNode, type Marks } from "./diagnostics";
import { edgeId, findSpec } from "./ops";

/** What the card of a node needs to draw itself. */
export interface CardData extends Record<string, unknown> {
  readonly alias: string;
  readonly type: string;
  /** The output ports, in the order the schema lists them; empty when the type is unknown. */
  readonly ports: readonly string[];
  readonly isTrigger: boolean;
  readonly known: boolean;
  /** How many diagnostics the node has, its fields included. */
  readonly problems: number;
  /** Whether one of them is an error. */
  readonly failing: boolean;
}

export type CardNode = Node<CardData>;

export function toFlowNodes(
  flow: Flow,
  catalog: readonly NodeSpec[],
  selected: ReadonlySet<string> = new Set(),
  marks: Marks = NO_MARKS,
): CardNode[] {
  return flow.nodes.map((node) => {
    const spec = findSpec(catalog, node.type, node.type_version);
    const problems = ofNode(marks, node.id);
    return {
      id: node.id,
      type: "card",
      position: { x: node.editor.x, y: node.editor.y },
      selected: selected.has(node.id),
      data: {
        alias: node.alias,
        type: node.type,
        ports: spec?.ports.map((p) => p.name) ?? [],
        isTrigger: spec?.trigger != null,
        known: spec !== undefined,
        problems: problems.length,
        failing: hasError(problems),
      },
    };
  });
}

export function toFlowEdges(
  flow: Flow,
  selected: ReadonlySet<string> = new Set(),
  marks: Marks = NO_MARKS,
): Edge[] {
  return flow.lines.map((line) => {
    const id = edgeId(line);
    return {
      id,
      source: line.from.node,
      sourceHandle: line.from.port,
      target: line.to,
      selected: selected.has(id),
      class: marks.lines.has(id) ? "problem" : "",
    };
  });
}

/** The line an edge draws, or `undefined` for an edge that has no source handle. */
export function lineOfEdge(edge: Edge): Line | undefined {
  if (edge.sourceHandle == null) return undefined;
  return {
    from: { node: edge.source, port: edge.sourceHandle },
    to: edge.target,
  };
}
