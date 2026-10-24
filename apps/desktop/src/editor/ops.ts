/**
 * The edits of a project, as pure functions: each takes the project part it changes and returns
 * a new one. Nothing here knows Svelte, Svelte Flow or Tauri. Rust checks the result again when
 * it is saved or validated, so these functions refuse only what the canvas could not draw.
 */

import type {
  FieldSpec,
  Flow,
  JsonValue,
  Line,
  NodeSpec,
  Project,
} from "../lib/bindings";
import {
  newAlias,
  newFlowName,
  newNodeId,
  type Random,
  secureRandom,
} from "./names";

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface LineEnd {
  readonly node: string;
  readonly port: string;
}

export type LineError =
  "unknown-node" | "unknown-port" | "into-trigger" | "duplicate-line";

export type LineResult =
  | { readonly ok: true; readonly flow: Flow }
  | { readonly ok: false; readonly error: LineError };

/** The schema of a node type and version, if the catalog has one. */
export function findSpec(
  catalog: readonly NodeSpec[],
  type: string,
  version: number,
): NodeSpec | undefined {
  return catalog.find(
    (spec) => spec.type_id === type && spec.version === version,
  );
}

/** The settings a new node starts with: what a required field can have without the user typing. */
export function defaultSettings(spec: NodeSpec): Record<string, JsonValue> {
  return defaultsFor(spec.fields);
}

/** What the required fields of `fields` can have without the user typing. */
export function defaultsFor(
  fields: readonly FieldSpec[],
): Record<string, JsonValue> {
  const settings: Record<string, JsonValue> = {};
  for (const field of fields) {
    if (!field.required) continue;
    const kind = field.kind;
    switch (kind.type) {
      case "Choice": {
        const first = kind.value[0];
        if (first !== undefined) settings[field.name] = first;
        break;
      }
      case "Boolean":
        settings[field.name] = false;
        break;
      case "Integer":
        settings[field.name] = kind.value.min;
        break;
      case "List":
        settings[field.name] = [];
        break;
      default:
        break;
    }
  }
  return settings;
}

/** Adds a node of `spec` at `position`; returns the new flow and the id of the node. */
export function addNode(
  flow: Flow,
  spec: NodeSpec,
  position: Position,
  random: Random = secureRandom,
): { readonly flow: Flow; readonly id: string } {
  const id = newNodeId(new Set(flow.nodes.map((n) => n.id)), random);
  const alias = newAlias(spec.type_id, new Set(flow.nodes.map((n) => n.alias)));
  return {
    id,
    flow: {
      ...flow,
      nodes: [
        ...flow.nodes,
        {
          id,
          alias,
          type: spec.type_id,
          type_version: spec.version,
          settings: defaultSettings(spec),
          editor: { x: position.x, y: position.y },
        },
      ],
    },
  };
}

/** Removes the nodes in `ids` and every line that starts or ends at one of them. */
export function removeNodes(flow: Flow, ids: ReadonlySet<string>): Flow {
  return {
    nodes: flow.nodes.filter((n) => !ids.has(n.id)),
    lines: flow.lines.filter((l) => !ids.has(l.from.node) && !ids.has(l.to)),
  };
}

/** The id of the edge that draws `line`. */
export function edgeId(line: Line): string {
  return `${line.from.node}:${line.from.port}->${line.to}`;
}

export function sameLine(a: Line, b: Line): boolean {
  return (
    a.from.node === b.from.node && a.from.port === b.from.port && a.to === b.to
  );
}

/** Removes the lines for which `remove` is true. */
export function removeLines(flow: Flow, remove: (line: Line) => boolean): Flow {
  return { ...flow, lines: flow.lines.filter((line) => !remove(line)) };
}

/** Adds a line from an output port to a node, or says why the canvas cannot draw it. */
export function addLine(
  flow: Flow,
  catalog: readonly NodeSpec[],
  from: LineEnd,
  to: string,
): LineResult {
  const source = flow.nodes.find((n) => n.id === from.node);
  const target = flow.nodes.find((n) => n.id === to);
  if (source === undefined || target === undefined) {
    return { ok: false, error: "unknown-node" };
  }
  const sourceSpec = findSpec(catalog, source.type, source.type_version);
  if (!sourceSpec?.ports.some((p) => p.name === from.port)) {
    return { ok: false, error: "unknown-port" };
  }
  const targetSpec = findSpec(catalog, target.type, target.type_version);
  if (targetSpec?.trigger) return { ok: false, error: "into-trigger" };
  const line: Line = { from: { node: from.node, port: from.port }, to };
  if (flow.lines.some((l) => sameLine(l, line))) {
    return { ok: false, error: "duplicate-line" };
  }
  return { ok: true, flow: { ...flow, lines: [...flow.lines, line] } };
}

/** Moves a node. A position that is not a finite number is ignored: Rust refuses it on save. */
export function moveNode(flow: Flow, id: string, position: Position): Flow {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return flow;
  }
  return {
    ...flow,
    nodes: flow.nodes.map((n) =>
      n.id === id ? { ...n, editor: { x: position.x, y: position.y } } : n,
    ),
  };
}

/** Replaces one flow of the project. */
export function withFlow(project: Project, name: string, flow: Flow): Project {
  return { ...project, flows: { ...project.flows, [name]: flow } };
}

/** Adds an empty flow; a name that is already used leaves the project as it was. */
export function addFlow(project: Project, name: string): Project {
  if (name in project.flows) return project;
  return withFlow(project, name, { nodes: [], lines: [] });
}

/** A name for a new flow that no flow of the project has. */
export function freshFlowName(project: Project): string {
  return newFlowName(new Set(Object.keys(project.flows)));
}
