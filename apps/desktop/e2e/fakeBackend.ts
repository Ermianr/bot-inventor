/**
 * A stand-in for the Rust side of the app, answering through `mockIPC` of `@tauri-apps/api`. The
 * Rust commands have their own tests; this only lets the renderer run in a plain browser. The test
 * reads and steers it through `window.__e2e`.
 */

import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  DiagnosticView,
  FieldSpec,
  Flow,
  NodeSpec,
  OpenedProject,
  Project,
} from "../src/lib/bindings";
import catalogJson from "./catalog.json";

const catalog = catalogJson as unknown as NodeSpec[];

export interface E2eState {
  /** Every command the renderer called, in order. */
  calls: { cmd: string; args: unknown }[];
  /** The projects `save_project` received, in order. */
  saved: Project[];
  /** What the folder dialog gives back for `open_project`; `null` is a cancelled dialog. */
  openResult: OpenedProject | null;
  /** Set to a message to make the next `save_project` fail like Rust would. */
  saveError: string | null;
  /** The `securitypolicyviolation` events of the page. */
  violations: string[];
}

declare global {
  interface Window {
    __e2e: E2eState;
  }
}

function emptyProject(name: string): Project {
  return {
    manifest: {
      format_version: 1,
      name,
      platform: "discord",
      settings: {},
      variables: [],
    },
    flows: { main: { nodes: [], lines: [] } },
  };
}

type Setting = unknown;

function missing(value: Setting): boolean {
  return value === undefined || value === null || value === "";
}

function checkFields(
  fields: readonly FieldSpec[],
  values: Record<string, Setting>,
  base: string,
  out: (path: string, message: string) => void,
): void {
  for (const field of fields) {
    const path = base === "" ? field.name : `${base}.${field.name}`;
    const value = values[field.name];
    if (missing(value)) {
      if (field.required) out(path, `\`${path}\` is required`);
      continue;
    }
    if (field.kind.type === "List" && Array.isArray(value)) {
      value.forEach((row, index) => {
        checkFields(
          field.kind.type === "List" ? field.kind.value.item : [],
          row as Record<string, Setting>,
          `${path}[${index}]`,
          out,
        );
      });
    }
  }
}

/** A small stand-in for compile: a missing required field, no trigger and an unreachable node. */
export function fakeValidate(project: Project): DiagnosticView[] {
  const found: DiagnosticView[] = [];
  for (const [flowName, flow] of Object.entries(project.flows)) {
    const specOf = (type: string, version: number): NodeSpec | undefined =>
      catalog.find((s) => s.type_id === type && s.version === version);
    for (const node of flow.nodes) {
      const spec = specOf(node.type, node.type_version);
      if (spec === undefined) continue;
      checkFields(spec.fields, node.settings, "", (path, message) => {
        found.push({
          flow: flowName,
          node: node.id,
          path,
          code: "missing-field",
          severity: "error",
          message,
        });
      });
    }
    const trigger = flow.nodes.find(
      (n) => specOf(n.type, n.type_version)?.trigger != null,
    );
    if (trigger === undefined) {
      found.push({
        flow: flowName,
        node: null,
        path: null,
        code: "no-trigger",
        severity: "error",
        message: "the flow has no trigger",
      });
    } else {
      for (const id of unreachable(flow, trigger.id)) {
        found.push({
          flow: flowName,
          node: id,
          path: null,
          code: "unreachable-node",
          severity: "error",
          message: "no line leads to this node",
        });
      }
    }
  }
  return found;
}

function unreachable(flow: Flow, from: string): string[] {
  const reached = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.pop();
    for (const line of flow.lines) {
      if (line.from.node === id && !reached.has(line.to)) {
        reached.add(line.to);
        queue.push(line.to);
      }
    }
  }
  return flow.nodes.map((n) => n.id).filter((id) => !reached.has(id));
}

export function installFakeBackend(): void {
  const state: E2eState = {
    calls: [],
    saved: [],
    openResult: null,
    saveError: null,
    violations: [],
  };
  window.__e2e = state;
  document.addEventListener("securitypolicyviolation", (event) => {
    state.violations.push(`${event.violatedDirective} ${event.blockedURI}`);
  });

  mockIPC((cmd, args) => {
    state.calls.push({ cmd, args });
    const input = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "app_info":
        return { name: "Bot Inventor", version: "e2e" };
      case "node_catalog":
        return catalog;
      case "new_project":
        return {
          project: emptyProject(String(input.name)),
          migrated_from: null,
        } satisfies OpenedProject;
      case "open_project":
        return state.openResult;
      case "save_project": {
        if (state.saveError !== null) {
          const message = state.saveError;
          state.saveError = null;
          // Tauri rejects with the serialized error as it is, not with an `Error`.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject({ kind: "project", message });
        }
        state.saved.push(structuredClone(input.project) as Project);
        return null;
      }
      case "validate_project":
        return fakeValidate(input.project as Project);
      default:
        return Promise.reject(
          new Error(`the fake backend has no command ${cmd}`),
        );
    }
  });
}
