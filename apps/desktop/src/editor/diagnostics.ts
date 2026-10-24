/**
 * Groups the diagnostics of `compile` by where the editor marks them: a field of the panel, a
 * node of the canvas or a line. Pure functions over what `validate_project` returns.
 */

import type { DiagnosticView, Flow } from "../lib/bindings";
import { edgeId } from "./ops";

export interface Totals {
  readonly errors: number;
  readonly warnings: number;
}

export interface Marks {
  /** Diagnostics of a node that name no field, by node id. */
  readonly nodes: ReadonlyMap<string, readonly DiagnosticView[]>;
  /** Diagnostics of a field, by `fieldKey(node, path)`. */
  readonly fields: ReadonlyMap<string, readonly DiagnosticView[]>;
  /** Diagnostics of a line, by the id of the edge that draws it. */
  readonly lines: ReadonlyMap<string, readonly DiagnosticView[]>;
}

export const NO_MARKS: Marks = {
  nodes: new Map(),
  fields: new Map(),
  lines: new Map(),
};

/** The key of a field in `Marks.fields`. */
export function fieldKey(node: string, path: string): string {
  return `${node}\u0000${path}`;
}

function add<K>(
  map: Map<K, DiagnosticView[]>,
  key: K,
  d: DiagnosticView,
): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [d]);
  else list.push(d);
}

/** The number of errors and warnings, across every flow and the project itself. */
export function totals(diagnostics: readonly DiagnosticView[]): Totals {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

/**
 * The marks for the flow that is shown. A diagnostic of another flow, one about no node, and one
 * about a node or a line that is not in the flow any more have no place on the canvas, and are
 * left out here (they still count in `totals`).
 */
export function groupDiagnostics(
  diagnostics: readonly DiagnosticView[],
  flowName: string | null,
  flow: Flow | null,
): Marks {
  if (flowName === null || flow === null) return NO_MARKS;
  const ids = new Set(flow.nodes.map((n) => n.id));
  const nodes = new Map<string, DiagnosticView[]>();
  const fields = new Map<string, DiagnosticView[]>();
  const lines = new Map<string, DiagnosticView[]>();
  for (const d of diagnostics) {
    if (d.flow !== flowName) continue;
    const lineNumber = lineIndex(d.path);
    if (lineNumber !== null) {
      const line = flow.lines[lineNumber];
      if (line !== undefined) add(lines, edgeId(line), d);
      continue;
    }
    if (d.node == null || !ids.has(d.node)) continue;
    if (d.path == null) add(nodes, d.node, d);
    else add(fields, fieldKey(d.node, d.path), d);
  }
  return { nodes, fields, lines };
}

/** The number of a line in `lines[3]`, or `null` when the path is not a line. */
export function lineIndex(path: string | null | undefined): number | null {
  const match = path == null ? null : /^lines\[([0-9]+)\]$/.exec(path);
  return match === null ? null : Number(match[1]);
}

/** The diagnostics of exactly this field. */
export function forField(
  marks: Marks,
  node: string,
  path: string,
): readonly DiagnosticView[] {
  return marks.fields.get(fieldKey(node, path)) ?? [];
}

/** The diagnostics of the fields inside this one (the rows of a list), not of the field itself. */
export function insideField(
  marks: Marks,
  node: string,
  path: string,
): readonly DiagnosticView[] {
  const start = fieldKey(node, path);
  const found: DiagnosticView[] = [];
  for (const [key, list] of marks.fields) {
    if (!key.startsWith(start)) continue;
    const rest = key.slice(start.length);
    if (rest.startsWith("[") || rest.startsWith(".")) found.push(...list);
  }
  return found;
}

/** Every diagnostic of a node: its own, those of its fields and those of its lines are not included. */
export function ofNode(marks: Marks, node: string): readonly DiagnosticView[] {
  const found: DiagnosticView[] = [...(marks.nodes.get(node) ?? [])];
  const start = `${node}\u0000`;
  for (const [key, list] of marks.fields) {
    if (key.startsWith(start)) found.push(...list);
  }
  return found;
}

/** Whether any of the diagnostics is an error. */
export function hasError(list: readonly DiagnosticView[]): boolean {
  return list.some((d) => d.severity === "error");
}
