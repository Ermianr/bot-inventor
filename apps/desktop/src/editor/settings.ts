/**
 * Edits of the settings of one node, by the path that `compile` uses for a field (`content`,
 * `options[0].name`). Pure functions over plain data; each returns the same object when it
 * changes nothing.
 */

import type { FieldSpec, Flow, JsonValue } from "../lib/bindings";
import { defaultsFor } from "./ops";
import { isAlias } from "./names";

export type Settings = Record<string, JsonValue>;

type Segment = { readonly key: string } | { readonly index: number };

/** Splits `options[0].name` into `options`, `0`, `name`; `null` when the path is not of that form. */
export function parsePath(path: string): Segment[] | null {
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[[0-9]+\])*)$/.exec(part);
    if (match === null) return null;
    segments.push({ key: match[1] ?? "" });
    for (const index of (match[2] ?? "").matchAll(/\[([0-9]+)\]/g)) {
      segments.push({ index: Number(index[1]) });
    }
  }
  return segments;
}

/** The path of `field` inside the object at `base` (`""` for the settings themselves). */
export function fieldPath(base: string, field: string): string {
  return base === "" ? field : `${base}.${field}`;
}

/** The path of row `index` of the list at `path`. */
export function rowPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function isObject(value: JsonValue | undefined): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at `path`, or `undefined` when something on the way is missing. */
export function getSetting(
  settings: Settings,
  path: string,
): JsonValue | undefined {
  const segments = parsePath(path);
  if (segments === null) return undefined;
  let current: JsonValue | undefined = settings;
  for (const segment of segments) {
    if ("key" in segment) {
      current = isObject(current) ? current[segment.key] : undefined;
    } else {
      current = Array.isArray(current) ? current[segment.index] : undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function replaceAt(
  node: JsonValue | undefined,
  segments: readonly Segment[],
  value: JsonValue | undefined,
): JsonValue | undefined {
  const [head, ...rest] = segments;
  if (head === undefined) return value;
  if ("key" in head) {
    if (!isObject(node)) return node;
    const child = rest.length === 0 ? undefined : node[head.key];
    if (rest.length > 0 && child === undefined) return node;
    const next = replaceAt(rest.length === 0 ? undefined : child, rest, value);
    if (next === node[head.key]) return node;
    if (next === undefined) {
      return Object.fromEntries(
        Object.entries(node).filter(([key]) => key !== head.key),
      );
    }
    return { ...node, [head.key]: next };
  }
  if (!Array.isArray(node) || head.index >= node.length) return node;
  const next = replaceAt(
    rest.length === 0 ? undefined : node[head.index],
    rest,
    value,
  );
  if (next === node[head.index] || next === undefined) return node;
  return node.map((item, i) => (i === head.index ? next : item));
}

/**
 * Sets the value at `path`; `undefined` removes it. A path that goes through a row or an object
 * that is not there changes nothing, and so does a path that is not well formed.
 */
export function setSetting(
  settings: Settings,
  path: string,
  value: JsonValue | undefined,
): Settings {
  const segments = parsePath(path);
  if (segments === null || segments.length === 0) return settings;
  const last = segments[segments.length - 1];
  if (last !== undefined && "index" in last) return settings;
  const next = replaceAt(settings, segments, value);
  return isObject(next) ? next : settings;
}

/** Adds a row, with what its required fields can have by themselves, to the list at `path`. */
export function addRow(
  settings: Settings,
  path: string,
  field: { readonly max: number; readonly item: readonly FieldSpec[] },
): Settings {
  const current = getSetting(settings, path);
  const rows = current === undefined ? [] : current;
  if (!Array.isArray(rows) || rows.length >= field.max) return settings;
  return setSetting(settings, path, [...rows, defaultsFor(field.item)]);
}

/**
 * Removes a row. A list left empty is removed too unless the field is required, so an optional
 * list that was cleared is just absent.
 */
export function removeRow(
  settings: Settings,
  path: string,
  index: number,
  required: boolean,
): Settings {
  const rows = getSetting(settings, path);
  if (!Array.isArray(rows) || index < 0 || index >= rows.length)
    return settings;
  const left = rows.filter((_, i) => i !== index);
  return setSetting(
    settings,
    path,
    left.length === 0 && !required ? undefined : left,
  );
}

export type AliasError = "invalid" | "taken" | "unknown-node";

export type AliasResult =
  | { readonly ok: true; readonly flow: Flow }
  | { readonly ok: false; readonly error: AliasError };

/** Renames a node. References to the old alias are not rewritten (compile reports them). */
export function renameAlias(
  flow: Flow,
  id: string,
  alias: string,
): AliasResult {
  const node = flow.nodes.find((n) => n.id === id);
  if (node === undefined) return { ok: false, error: "unknown-node" };
  if (!isAlias(alias)) return { ok: false, error: "invalid" };
  if (node.alias === alias) return { ok: true, flow };
  if (flow.nodes.some((n) => n.alias === alias)) {
    return { ok: false, error: "taken" };
  }
  return {
    ok: true,
    flow: {
      ...flow,
      nodes: flow.nodes.map((n) => (n.id === id ? { ...n, alias } : n)),
    },
  };
}

/** Sets the settings of one node of a flow. */
export function withSettings(flow: Flow, id: string, settings: Settings): Flow {
  const node = flow.nodes.find((n) => n.id === id);
  if (node === undefined || node.settings === settings) return flow;
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === id ? { ...n, settings } : n)),
  };
}
