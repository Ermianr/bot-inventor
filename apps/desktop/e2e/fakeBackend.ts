/**
 * A stand-in for the Rust side of the app, answering through `mockIPC` of `@tauri-apps/api`. The
 * Rust commands have their own tests; this only lets the renderer run in a plain browser. The test
 * reads and steers it through `window.__e2e`.
 */

import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  Condition,
  DiagnosticView,
  FieldSpec,
  Flow,
  NameInfo,
  NameList,
  NodeSpec,
  Operand,
  OpenedProject,
  Project,
  Renamed,
  Row,
  RunEvent,
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
  /** Whether the fake bot is up: between `start_bot` and its exit. */
  running: boolean;
  /** The bot token the fake `.env` holds. The page must never show it. */
  token: string | null;
  devGuild: string | null;
  /** The names `export_bot` wrote, in order. */
  exported: string[];
  /** Makes the next `export_bot` behave as if the person cancelled the folder dialog. */
  exportCancel: boolean;
  /** Sends an event to the page through the channel `start_bot` received, as Rust would. */
  send(event: RunEvent): void;
  /** Sends this many `info` lines, one event each. */
  flood(count: number): void;
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

/** The aliases that a text reads as `steps.<alias>`, found with a pattern: this is a stand-in. */
function stepsRead(text: string): string[] {
  return [...text.matchAll(/(?<![.\w])steps\.([a-z_][a-z0-9_]*)/g)].map(
    (match) => match[1] ?? "",
  );
}

function checkFields(
  fields: readonly FieldSpec[],
  values: Record<string, Setting>,
  base: string,
  out: (path: string, message: string, code?: string) => void,
  aliases: ReadonlySet<string>,
): void {
  for (const field of fields) {
    const path = base === "" ? field.name : `${base}.${field.name}`;
    const value = values[field.name];
    if (missing(value)) {
      if (field.required) out(path, `\`${path}\` is required`);
      continue;
    }
    const kind = field.kind;
    const holdsExpression =
      kind.type === "Expression" ||
      kind.type === "Condition" ||
      (kind.type === "Text" && kind.value.template);
    if (holdsExpression && typeof value === "string") {
      for (const alias of stepsRead(value)) {
        if (!aliases.has(alias)) {
          out(
            path,
            `no node of this flow has the alias \`${alias}\``,
            "unknown-step",
          );
        }
      }
    }
    if (field.kind.type === "List" && Array.isArray(value)) {
      value.forEach((row, index) => {
        checkFields(
          field.kind.type === "List" ? field.kind.value.item : [],
          row as Record<string, Setting>,
          `${path}[${index}]`,
          out,
          aliases,
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
      const aliases = new Set(flow.nodes.map((n) => n.alias));
      checkFields(
        spec.fields,
        node.settings,
        "",
        (path, message, code = "missing-field") => {
          found.push({
            flow: flowName,
            node: node.id,
            path,
            code,
            severity: "error",
            message,
          });
        },
        aliases,
      );
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

// --- the condition builder -----------------------------------------------------------------

const ROOTS = ["event", "steps", "vars", "error"];

/** Fails like a command of Rust that returns `Err(EditorError::InvalidInput(..))`. */
function refuse(message: string): never {
  // Tauri rejects with the serialized error as it is, not with an `Error`.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw { kind: "invalid_input", message };
}

/** The text is not a condition of the builder. */
class Unreadable extends Error {}

function specOf(node: {
  type: string;
  type_version: number;
}): NodeSpec | undefined {
  return catalog.find(
    (s) => s.type_id === node.type && s.version === node.type_version,
  );
}

function ancestors(flow: Flow, id: string): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const line of flow.lines) {
      if (line.to === current && !found.has(line.from.node)) {
        found.add(line.from.node);
        queue.push(line.from.node);
      }
    }
  }
  return found;
}

function info(
  group: NameInfo["group"],
  segments: string[],
  kind: NameInfo["kind"],
  optional = false,
): NameInfo {
  return {
    group,
    segments,
    source: nameSource(segments),
    kind,
    availability: "Always",
    optional,
  };
}

/** A stand-in for `expression_names`: the event, the nodes with a line to this one, variables. */
export function fakeNames(
  project: Project,
  flowName: string,
  nodeId: string,
): NameList {
  const flow = project.flows[flowName];
  if (!flow?.nodes.some((n) => n.id === nodeId)) {
    return refuse("the flow has no such node");
  }
  const names: NameInfo[] = [];
  const trigger = flow.nodes.find((n) => specOf(n)?.trigger != null);
  const triggerSpec =
    trigger === undefined ? undefined : specOf(trigger)?.trigger;
  if (trigger !== undefined && triggerSpec != null) {
    for (const field of triggerSpec.fields) {
      names.push(
        info("Event", ["event", ...field.path.split(".")], field.kind),
      );
    }
    const options = trigger.settings[triggerSpec.options_field ?? ""];
    if (Array.isArray(options)) {
      for (const option of options as Record<string, unknown>[]) {
        if (typeof option.name !== "string") continue;
        const kind =
          option.type === "integer"
            ? "Integer"
            : option.type === "number"
              ? "Decimal"
              : option.type === "boolean"
                ? "Boolean"
                : "Text";
        names.push(
          info(
            "Event",
            ["event", "options", option.name],
            kind,
            option.required !== true,
          ),
        );
      }
    }
  }
  const before = ancestors(flow, nodeId);
  for (const node of flow.nodes) {
    if (!before.has(node.id)) continue;
    for (const output of specOf(node)?.outputs ?? []) {
      names.push(info("Step", ["steps", node.alias, output.name], output.kind));
    }
  }
  const scopes = { run: 0, bot: 1, server: 2, member: 3, user: 4 } as const;
  const variables = [...project.manifest.variables].sort(
    (a, b) => scopes[a.scope] - scopes[b.scope] || a.name.localeCompare(b.name),
  );
  for (const variable of variables) {
    const kind = {
      integer: "Integer",
      decimal: "Decimal",
      text: "Text",
      boolean: "Boolean",
    }[variable.type] as NameInfo["kind"];
    names.push(info("Variable", ["vars", variable.scope, variable.name], kind));
  }
  return { order_known: true, names };
}

function identifier(segment: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment);
}

function nameSource(segments: readonly string[]): string {
  return segments
    .map((segment, i) =>
      i === 0
        ? segment
        : identifier(segment)
          ? `.${segment}`
          : `[${JSON.stringify(segment)}]`,
    )
    .join("");
}

function operandSource(operand: Operand): string {
  switch (operand.type) {
    case "Name":
      return nameSource(operand.value);
    case "Text":
      return JSON.stringify(operand.value);
    case "Integer":
      return String(operand.value);
    case "Decimal":
      return Number.isInteger(operand.value)
        ? `${operand.value}.0`
        : String(operand.value);
    case "Boolean":
      return String(operand.value);
  }
}

const COMPARE_SOURCE = {
  Eq: "==",
  Ne: "!=",
  Lt: "<",
  Le: "<=",
  Gt: ">",
  Ge: ">=",
} as const;
const TEXT_SOURCE = {
  Contains: "contains",
  StartsWith: "startsWith",
  EndsWith: "endsWith",
} as const;

function rowSource(row: Row): string {
  switch (row.type) {
    case "Compare":
      return `${operandSource(row.left)} ${COMPARE_SOURCE[row.op]} ${operandSource(row.right)}`;
    case "Text":
      return `${row.negated ? "!" : ""}${operandSource(row.left)}.${TEXT_SOURCE[row.op]}(${operandSource(row.right)})`;
    case "Member": {
      const test = `${operandSource(row.item)} in ${operandSource(row.list)}`;
      return row.negated ? `!(${test})` : test;
    }
    case "Present":
      return `${row.negated ? "!" : ""}has(${nameSource(row.name)})`;
  }
}

/** A stand-in for `condition_to_source`. */
export function fakeToSource(condition: Condition): string {
  if (condition.rows.length === 0) {
    return refuse("a condition needs at least one row");
  }
  return condition.rows
    .map(rowSource)
    .join(condition.join === "Any" ? " || " : " && ");
}

const TOKEN =
  /\s*(?:(&&|\|\||==|!=|<=|>=|<|>|!|\(|\)|\[|\]|\.)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(-?\d+\.\d+|-?\d+)|([A-Za-z_]\w*))/y;

function tokenize(source: string): string[] | null {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    if (/^\s*$/.test(source.slice(TOKEN.lastIndex))) break;
    const match = TOKEN.exec(source);
    if (match === null) return null;
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "");
  }
  return tokens;
}

/** A stand-in for `condition_from_source`: the shapes the end-to-end tests write. */
export function fakeFromSource(source: string): Condition | null {
  if (source.trim() === "") {
    return refuse("the expression is empty");
  }
  const tokens = tokenize(source);
  if (tokens === null) return null;
  let at = 0;
  const peek = (offset = 0) => tokens[at + offset];
  const take = () => tokens[at++];
  const fail = (): never => {
    throw new Unreadable();
  };

  function operand(): Operand {
    const token = take() ?? "";
    if (/^["']/.test(token)) {
      return {
        type: "Text",
        value: token.slice(1, -1).replace(/\\(.)/g, "$1"),
      };
    }
    if (/^-?\d+\.\d+$/.test(token))
      return { type: "Decimal", value: Number(token) };
    if (/^-?\d+$/.test(token)) return { type: "Integer", value: Number(token) };
    if (token === "true" || token === "false")
      return { type: "Boolean", value: token === "true" };
    if (!ROOTS.includes(token)) return fail();
    const segments = [token];
    for (;;) {
      if (
        peek() === "." &&
        /^[A-Za-z_]/.test(peek(1) ?? "") &&
        peek(2) !== "("
      ) {
        take();
        segments.push(take() ?? "");
      } else if (
        peek() === "[" &&
        /^["']/.test(peek(1) ?? "") &&
        peek(2) === "]"
      ) {
        take();
        segments.push((take() ?? "").slice(1, -1));
        take();
      } else break;
    }
    if (segments.length < 2) return fail();
    return { type: "Name", value: segments };
  }

  function row(): Row {
    const negated = peek() === "!";
    if (negated) take();
    if (negated && peek() === "(") {
      take();
      const item = operand();
      if (take() !== "in") return fail();
      const list = operand();
      if (take() !== ")") return fail();
      return { type: "Member", negated, item, list };
    }
    if (peek() === "has" && peek(1) === "(") {
      take();
      take();
      const name = operand();
      if (take() !== ")" || name.type !== "Name") return fail();
      return { type: "Present", negated, name: name.value };
    }
    const left = operand();
    const next = take();
    if (next === ".") {
      const method = take();
      const op =
        method === "contains"
          ? "Contains"
          : method === "startsWith"
            ? "StartsWith"
            : method === "endsWith"
              ? "EndsWith"
              : undefined;
      if (op === undefined || take() !== "(") return fail();
      const right = operand();
      if (take() !== ")") return fail();
      return { type: "Text", negated, left, op, right };
    }
    if (negated) return fail();
    if (next === "in")
      return { type: "Member", negated: false, item: left, list: operand() };
    const compare = {
      "==": "Eq",
      "!=": "Ne",
      "<": "Lt",
      "<=": "Le",
      ">": "Gt",
      ">=": "Ge",
    }[next ?? ""] as keyof typeof COMPARE_SOURCE | undefined;
    if (compare === undefined) return fail();
    return { type: "Compare", left, op: compare, right: operand() };
  }

  try {
    const rows = [row()];
    const join = peek();
    while (peek() === join && (join === "&&" || join === "||")) {
      take();
      rows.push(row());
    }
    if (at !== tokens.length || rows.length > 8) return null;
    return { join: join === "||" ? "Any" : "All", rows };
  } catch (error) {
    if (error instanceof Unreadable) return null;
    throw error;
  }
}

/** A stand-in for `rename_alias`: a pattern instead of the parser of Rust. */
export function fakeRename(
  project: Project,
  flowName: string,
  nodeId: string,
  alias: string,
): Renamed {
  const flow = project.flows[flowName];
  const target = flow?.nodes.find((n) => n.id === nodeId);
  if (flow === undefined || target === undefined) {
    return refuse("the flow has no such node");
  }
  if (!/^[a-z_][a-z0-9_]{0,63}$/.test(alias)) {
    return refuse("invalid alias");
  }
  if (flow.nodes.some((n) => n.alias === alias && n.id !== nodeId)) {
    return refuse("another node of this flow already has that alias");
  }
  const old = target.alias;
  const reads = new RegExp(`(?<![.\\w])steps\\.${old}(?![\\w])`, "g");
  const rewritten: Renamed["rewritten"] = [];
  const next = structuredClone(project);
  for (const node of next.flows[flowName]?.nodes ?? []) {
    if (node.id === nodeId) node.alias = alias;
    const kinds = specOf(node)?.fields ?? [];
    for (const field of kinds) {
      const value = node.settings[field.name];
      const holds =
        field.kind.type === "Expression" ||
        field.kind.type === "Condition" ||
        (field.kind.type === "Text" && field.kind.value.template);
      if (holds && typeof value === "string" && reads.test(value)) {
        reads.lastIndex = 0;
        node.settings[field.name] = value.replace(reads, `steps.${alias}`);
        rewritten.push({ node: node.id, path: field.name });
      }
      reads.lastIndex = 0;
    }
  }
  return { project: next, rewritten, left_alone: [] };
}

/** Tauri rejects with the serialized error as it is, not with an `Error`. */
function reject(kind: string, message?: string): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  return Promise.reject(message === undefined ? { kind } : { kind, message });
}

/** The id of the channel a command received (`Channel` serializes as `__CHANNEL__:<id>`). */
function channelId(value: unknown): number {
  if (typeof value === "object" && value !== null && "id" in value) {
    return Number(value.id);
  }
  return Number(String(value).replace("__CHANNEL__:", ""));
}

/** The reason `exporter::check_name` would give for a name, or `null` when it is fine. */
function nameProblem(name: string): string | null {
  if (name === "") return "the name is empty";
  if (name.startsWith(".")) return "the name starts with a dot";
  if (name.startsWith("-")) return "the name starts with a dash";
  if (/[/\\]/.test(name)) return "the name has a path separator";
  if (["assets", "data"].includes(name.toLowerCase())) {
    return "the name is one the exported bot uses for its own files";
  }
  return null;
}

export function installFakeBackend(): void {
  let channel: number | null = null;
  let index = 0;
  const state: E2eState = {
    calls: [],
    saved: [],
    openResult: null,
    saveError: null,
    violations: [],
    running: false,
    token: null,
    devGuild: null,
    exported: [],
    exportCancel: false,
    send(event) {
      if (channel === null) return;
      if (event.kind === "status" && event.data.state === "exited") {
        state.running = false;
      }
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            runCallback(id: number, data: unknown): void;
          };
        }
      ).__TAURI_INTERNALS__;
      internals.runCallback(channel, { index: index++, message: event });
    },
    flood(count) {
      for (let i = 0; i < count; i++) {
        state.send({
          kind: "log",
          data: {
            ts: "2026-10-24T10:00:00.000Z",
            level: "info",
            source: "engine",
            run: null,
            flow: null,
            node: null,
            msg: `line ${i}`,
          },
        });
      }
    },
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
      case "expression_names":
        return fakeNames(
          input.project as Project,
          String(input.flow),
          String(input.node),
        );
      case "condition_to_source":
        return fakeToSource(input.condition as Condition);
      case "condition_from_source":
        return fakeFromSource(String(input.source));
      case "rename_alias":
        return fakeRename(
          input.project as Project,
          String(input.flow),
          String(input.node),
          String(input.alias),
        );
      case "start_bot": {
        if (state.running) return reject("already_running");
        const diagnostics = fakeValidate(input.project as Project).filter(
          (d) => d.severity === "error",
        );
        if (diagnostics.length > 0) return { outcome: "invalid", diagnostics };
        state.running = true;
        channel = channelId(input.events);
        index = 0;
        state.send({ kind: "status", data: { state: "starting" } });
        return { outcome: "started" };
      }
      case "stop_bot": {
        if (!state.running) return "not_running";
        state.send({ kind: "status", data: { state: "stopping" } });
        state.send({
          kind: "status",
          data: {
            state: "exited",
            code: 0,
            signal: null,
            reason: "clean",
            requested: true,
          },
        });
        return "stopped";
      }
      case "set_token": {
        const token = String(input.token);
        if (!/^[A-Za-z0-9._-]{1,256}$/.test(token)) {
          return reject(
            "invalid_input",
            "the token must have 1 to 256 letters, digits, dots, dashes or underscores",
          );
        }
        state.token = token;
        return null;
      }
      case "token_status":
        return { token_set: state.token !== null, dev_guild: state.devGuild };
      case "set_dev_guild": {
        const guild = input.guild as string | null;
        if (guild !== null && !/^\d{1,20}$/.test(guild)) {
          return reject(
            "invalid_input",
            "the server id must have 1 to 20 digits",
          );
        }
        state.devGuild = guild;
        return null;
      }
      case "export_bot": {
        const name = String(input.name);
        const problem = nameProblem(name);
        if (problem !== null) return reject("invalid_input", problem);
        const diagnostics = fakeValidate(input.project as Project).filter(
          (d) => d.severity === "error",
        );
        if (diagnostics.length > 0) return { outcome: "invalid", diagnostics };
        if (state.exportCancel) {
          state.exportCancel = false;
          return null;
        }
        state.exported.push(name);
        return { outcome: "exported", path: `/tmp/e2e/${name}`, assets: 0 };
      }
      default:
        return Promise.reject(
          new Error(`the fake backend has no command ${cmd}`),
        );
    }
  });
}
