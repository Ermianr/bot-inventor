/**
 * The rows of the condition builder as the panel edits them: pure functions over the `Condition`
 * that Rust describes (`condition_from_source`, `condition_to_source`). The panel offers one list of
 * tests; each test is one of the four kinds of row, and `withOp` turns a row into another kind
 * keeping its two sides.
 */

import type {
  Condition,
  NameGroup,
  NameInfo,
  NameList,
  Operand,
  Row,
  ValueKind,
} from "../lib/bindings";

/** The most rows in one condition (`runtime::condition::MAX_ROWS`). */
export const MAX_ROWS = 8;

export type RowOp =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "not_starts_with"
  | "ends_with"
  | "not_ends_with"
  | "includes"
  | "not_includes"
  | "set"
  | "not_set";

/** The kinds of value a person can type into a side of a row. */
export type ValueType = "text" | "integer" | "decimal" | "boolean";

const COMPARE = {
  eq: "Eq",
  ne: "Ne",
  lt: "Lt",
  le: "Le",
  gt: "Gt",
  ge: "Ge",
} as const;

const TEXT = {
  contains: "Contains",
  starts_with: "StartsWith",
  ends_with: "EndsWith",
} as const;

const NUMBER_OPS: readonly RowOp[] = ["eq", "ne", "lt", "le", "gt", "ge"];
const TEXT_OPS: readonly RowOp[] = [
  "eq",
  "ne",
  "contains",
  "not_contains",
  "starts_with",
  "not_starts_with",
  "ends_with",
  "not_ends_with",
];
const LIST_OPS: readonly RowOp[] = ["includes", "not_includes"];
const PRESENCE_OPS: readonly RowOp[] = ["set", "not_set"];

export function rowOp(row: Row): RowOp {
  switch (row.type) {
    case "Compare":
      return row.op === "Eq"
        ? "eq"
        : row.op === "Ne"
          ? "ne"
          : row.op === "Lt"
            ? "lt"
            : row.op === "Le"
              ? "le"
              : row.op === "Gt"
                ? "gt"
                : "ge";
    case "Text": {
      const base =
        row.op === "Contains"
          ? "contains"
          : row.op === "StartsWith"
            ? "starts_with"
            : "ends_with";
      return row.negated ? (`not_${base}` as RowOp) : base;
    }
    case "Member":
      return row.negated ? "not_includes" : "includes";
    case "Present":
      return row.negated ? "not_set" : "set";
  }
}

/** The left side: for a list test, the list; for a presence test, the name. */
export function leftOf(row: Row): Operand {
  switch (row.type) {
    case "Compare":
    case "Text":
      return row.left;
    case "Member":
      return row.list;
    case "Present":
      return { type: "Name", value: row.name };
  }
}

/** The right side: for a list test, the item; a presence test has none. */
export function rightOf(row: Row): Operand | null {
  switch (row.type) {
    case "Compare":
    case "Text":
      return row.right;
    case "Member":
      return row.item;
    case "Present":
      return null;
  }
}

/** The row of the kind `op` names, with these two sides. */
function build(op: RowOp, left: Operand, right: Operand): Row {
  if (op in COMPARE) {
    return {
      type: "Compare",
      left,
      op: COMPARE[op as keyof typeof COMPARE],
      right,
    };
  }
  if (op === "includes" || op === "not_includes") {
    return {
      type: "Member",
      negated: op === "not_includes",
      item: right,
      list: left,
    };
  }
  if (op === "set" || op === "not_set") {
    return {
      type: "Present",
      negated: op === "not_set",
      name: left.type === "Name" ? left.value : [],
    };
  }
  const negated = op.startsWith("not_");
  const base = (negated ? op.slice(4) : op) as keyof typeof TEXT;
  return { type: "Text", negated, left, op: TEXT[base], right };
}

/** The value a right side starts with after a change of test, by what the left side is. */
export function defaultRight(left: Operand, names: NameList | null): Operand {
  switch (kindOf(left, names)) {
    case "Integer":
      return { type: "Integer", value: 0 };
    case "Decimal":
      return { type: "Decimal", value: 0 };
    case "Boolean":
      return { type: "Boolean", value: true };
    default:
      return { type: "Text", value: "" };
  }
}

/** The row with another test. A presence test needs a name on the left, so it is refused. */
export function withOp(row: Row, op: RowOp, names: NameList | null): Row {
  const left = leftOf(row);
  if ((op === "set" || op === "not_set") && left.type !== "Name") return row;
  if (rowOp(row) === op) return row;
  const right = rightOf(row) ?? defaultRight(left, names);
  return build(op, left, right);
}

export function withLeft(row: Row, left: Operand, names: NameList | null): Row {
  const op = rowOp(row);
  if ((op === "set" || op === "not_set") && left.type !== "Name") return row;
  const right = rightOf(row) ?? defaultRight(left, names);
  return build(op, left, right);
}

export function withRight(row: Row, right: Operand): Row {
  if (row.type === "Present") return row;
  return build(rowOp(row), leftOf(row), right);
}

function sameName(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

/** The name of the list that these segments spell. */
export function findName(
  names: NameList | null,
  segments: readonly string[],
): NameInfo | undefined {
  return names?.names.find((n) => sameName(n.segments, segments));
}

/** What an operand is, as far as the panel knows; `null` for a name that is not offered. */
export function kindOf(
  operand: Operand,
  names: NameList | null,
): ValueKind | null {
  switch (operand.type) {
    case "Name":
      return findName(names, operand.value)?.kind ?? null;
    case "Text":
      return "Text";
    case "Integer":
      return "Integer";
    case "Decimal":
      return "Decimal";
    case "Boolean":
      return "Boolean";
  }
}

/**
 * Whether a name points at something that is not offered at this node: a deleted node, an alias
 * that no longer exists. Where the order of the flow is not known the steps and `error` names
 * cannot be told, so they are not reported.
 */
export function isMissing(operand: Operand, names: NameList | null): boolean {
  if (operand.type !== "Name" || names === null) return false;
  const root = operand.value[0];
  if (!names.order_known && (root === "steps" || root === "error")) {
    return false;
  }
  return findName(names, operand.value) === undefined;
}

/** Whether any side of the row points at a name that is not offered. */
export function rowIsMissing(row: Row, names: NameList | null): boolean {
  const right = rightOf(row);
  return (
    isMissing(leftOf(row), names) || (right !== null && isMissing(right, names))
  );
}

/** The tests to offer for a left side; the one the row has now is always among them. */
export function opsFor(
  left: Operand,
  current: RowOp,
  names: NameList | null,
): readonly RowOp[] {
  const info = left.type === "Name" ? findName(names, left.value) : undefined;
  const kind = kindOf(left, names);
  let ops: RowOp[];
  switch (kind) {
    case "Text":
      ops = [...TEXT_OPS];
      break;
    case "Integer":
    case "Decimal":
      ops = [...NUMBER_OPS];
      break;
    case "Boolean":
      ops = ["eq", "ne"];
      break;
    case "List":
      ops = [...LIST_OPS];
      break;
    default:
      ops = [...NUMBER_OPS, ...TEXT_OPS.slice(2), ...LIST_OPS];
  }
  if (info?.optional === true && canTestPresence(info)) {
    ops.push(...PRESENCE_OPS);
  }
  if (!ops.includes(current)) ops.push(current);
  return ops;
}

/**
 * Whether `has(name)` can be written for this name: the last segment has to be a plain
 * identifier, as `has()` takes a field selection. Rust refuses the others with a message.
 */
export function canTestPresence(info: NameInfo): boolean {
  const last = info.segments[info.segments.length - 1] ?? "";
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(last);
}

/** The names of a list grouped for a menu, in the order of the groups. */
export function groupedNames(
  names: NameList | null,
): readonly { group: NameGroup; names: readonly NameInfo[] }[] {
  const order: NameGroup[] = ["Event", "Step", "Variable", "Error"];
  return order
    .map((group) => ({
      group,
      names: names?.names.filter((n) => n.group === group) ?? [],
    }))
    .filter((entry) => entry.names.length > 0);
}

/** What a typed value starts as. */
export function emptyValue(type: ValueType): Operand {
  switch (type) {
    case "text":
      return { type: "Text", value: "" };
    case "integer":
      return { type: "Integer", value: 0 };
    case "decimal":
      return { type: "Decimal", value: 0 };
    case "boolean":
      return { type: "Boolean", value: true };
  }
}

/** The kind of typed value an operand is, or `null` for a name. */
export function valueType(operand: Operand): ValueType | null {
  switch (operand.type) {
    case "Name":
      return null;
    case "Text":
      return "text";
    case "Integer":
      return "integer";
    case "Decimal":
      return "decimal";
    case "Boolean":
      return "boolean";
  }
}

/** A row to start from: the first name of the list compared with empty text. */
export function newRow(names: NameList | null): Row | null {
  const first = names?.names[0];
  if (first === undefined) return null;
  const left: Operand = { type: "Name", value: first.segments };
  return build("eq", left, defaultRight(left, names));
}

/** The condition after adding a row; the same one when it is full or no name is offered. */
export function addRow(
  condition: Condition | null,
  names: NameList | null,
): Condition | null {
  const rows = condition?.rows ?? [];
  if (rows.length >= MAX_ROWS) return condition;
  const row = newRow(names);
  if (row === null) return condition;
  return { join: condition?.join ?? "All", rows: [...rows, row] };
}

/** The condition after removing row `index`; `null` when none is left. */
export function removeRow(
  condition: Condition,
  index: number,
): Condition | null {
  const rows = condition.rows.filter((_, i) => i !== index);
  return rows.length === 0 ? null : { ...condition, rows };
}

export function replaceRow(
  condition: Condition,
  index: number,
  row: Row,
): Condition {
  return {
    ...condition,
    rows: condition.rows.map((r, i) => (i === index ? row : r)),
  };
}

/** A condition of one row is always `All`, as Rust reads it back. */
export function withJoin(
  condition: Condition,
  join: Condition["join"],
): Condition {
  return { ...condition, join: condition.rows.length > 1 ? join : "All" };
}
