import { describe, expect, it } from "vitest";
import type {
  Condition,
  NameInfo,
  NameList,
  Operand,
  Row,
} from "../lib/bindings";
import {
  addRow,
  canTestPresence,
  findName,
  groupedNames,
  isMissing,
  kindOf,
  leftOf,
  MAX_ROWS,
  newRow,
  opsFor,
  removeRow,
  replaceRow,
  rightOf,
  rowIsMissing,
  rowOp,
  withJoin,
  withLeft,
  withOp,
  withRight,
  type RowOp,
} from "./condition";

function name(
  source: string,
  kind: NameInfo["kind"],
  extra: Partial<NameInfo> = {},
): NameInfo {
  const segments = source.split(".");
  return {
    group: (
      {
        event: "Event",
        steps: "Step",
        vars: "Variable",
        error: "Error",
      } as const
    )[segments[0] as "event"],
    segments,
    source,
    kind,
    availability: "Always",
    optional: false,
    ...extra,
  };
}

const names: NameList = {
  order_known: true,
  names: [
    name("event.user.id", "Text"),
    name("event.member.roles", "List"),
    name("event.options.amount", "Integer"),
    name("event.options.ratio", "Decimal", { optional: true }),
    name("event.options.silent", "Boolean"),
    {
      ...name("event.options.x", "Text"),
      segments: ["event", "options", "mi-opción"],
      optional: true,
    },
    name("steps.first.message_id", "Text"),
    name("vars.bot.greeting", "Text"),
    name("vars.bot.any", "Any"),
  ],
};

const id: Operand = { type: "Name", value: ["event", "user", "id"] };
const roles: Operand = { type: "Name", value: ["event", "member", "roles"] };
const text = (value: string): Operand => ({ type: "Text", value });

const compare: Row = { type: "Compare", left: id, op: "Eq", right: text("1") };

describe("rows as one list of tests", () => {
  it("names the test of every kind of row", () => {
    const rows: [Row, RowOp][] = [
      [compare, "eq"],
      [{ ...compare, op: "Ne" }, "ne"],
      [{ ...compare, op: "Lt" }, "lt"],
      [{ ...compare, op: "Le" }, "le"],
      [{ ...compare, op: "Gt" }, "gt"],
      [{ ...compare, op: "Ge" }, "ge"],
      [
        {
          type: "Text",
          negated: false,
          left: id,
          op: "Contains",
          right: text("a"),
        },
        "contains",
      ],
      [
        {
          type: "Text",
          negated: true,
          left: id,
          op: "StartsWith",
          right: text("a"),
        },
        "not_starts_with",
      ],
      [
        {
          type: "Text",
          negated: false,
          left: id,
          op: "EndsWith",
          right: text("a"),
        },
        "ends_with",
      ],
      [
        { type: "Member", negated: false, item: text("1"), list: roles },
        "includes",
      ],
      [
        { type: "Member", negated: true, item: text("1"), list: roles },
        "not_includes",
      ],
      [
        {
          type: "Present",
          negated: false,
          name: ["event", "options", "ratio"],
        },
        "set",
      ],
      [
        { type: "Present", negated: true, name: ["event", "options", "ratio"] },
        "not_set",
      ],
    ];
    for (const [row, op] of rows) expect(rowOp(row), op).toBe(op);
  });

  it("reads the two sides of a list test as list on the left and item on the right", () => {
    const row: Row = {
      type: "Member",
      negated: false,
      item: text("1"),
      list: roles,
    };
    expect(leftOf(row)).toEqual(roles);
    expect(rightOf(row)).toEqual(text("1"));
    const present: Row = {
      type: "Present",
      negated: false,
      name: ["event", "options", "ratio"],
    };
    expect(leftOf(present)).toEqual({
      type: "Name",
      value: ["event", "options", "ratio"],
    });
    expect(rightOf(present)).toBeNull();
  });

  it("changes a row into another kind and keeps its sides", () => {
    const text_row = withOp(compare, "contains", names);
    expect(text_row).toEqual({
      type: "Text",
      negated: false,
      left: id,
      op: "Contains",
      right: text("1"),
    });
    const member = withOp(text_row, "not_includes", names);
    expect(member).toEqual({
      type: "Member",
      negated: true,
      item: text("1"),
      list: id,
    });
    expect(withOp(member, "eq", names)).toEqual({ ...compare, left: id });
    expect(withOp(compare, "eq", names)).toBe(compare);
  });

  it("refuses a presence test on something that is not a name", () => {
    const row: Row = { ...compare, left: text("a") };
    expect(withOp(row, "set", names)).toBe(row);
    expect(
      withLeft(
        {
          type: "Present",
          negated: false,
          name: ["event", "options", "ratio"],
        },
        text("a"),
        names,
      ),
    ).toEqual({
      type: "Present",
      negated: false,
      name: ["event", "options", "ratio"],
    });
  });

  it("starts the right side by the kind of the left", () => {
    const amount: Operand = {
      type: "Name",
      value: ["event", "options", "amount"],
    };
    expect(withLeft(compare, amount, names)).toEqual({
      ...compare,
      left: amount,
    });
    const to_number = withOp(
      { type: "Present", negated: false, name: ["event", "options", "amount"] },
      "gt",
      names,
    );
    expect(to_number).toEqual({
      type: "Compare",
      left: amount,
      op: "Gt",
      right: { type: "Integer", value: 0 },
    });
    const flag = withOp(
      { type: "Present", negated: false, name: ["event", "options", "silent"] },
      "eq",
      names,
    );
    expect(rightOf(flag)).toEqual({ type: "Boolean", value: true });
  });

  it("changes a side", () => {
    expect(withRight(compare, text("2"))).toEqual({
      ...compare,
      right: text("2"),
    });
    const present: Row = {
      type: "Present",
      negated: false,
      name: ["event", "options", "ratio"],
    };
    expect(withRight(present, text("2"))).toBe(present);
    const member: Row = {
      type: "Member",
      negated: false,
      item: text("1"),
      list: roles,
    };
    expect(withRight(member, text("9"))).toEqual({
      ...member,
      item: text("9"),
    });
  });
});

describe("what to offer", () => {
  it("offers the tests of the kind of the left side", () => {
    expect(opsFor(id, "eq", names)).toContain("starts_with");
    expect(opsFor(id, "eq", names)).not.toContain("lt");
    expect(opsFor(roles, "includes", names)).toEqual([
      "includes",
      "not_includes",
    ]);
    const amount: Operand = {
      type: "Name",
      value: ["event", "options", "amount"],
    };
    expect(opsFor(amount, "eq", names)).toEqual([
      "eq",
      "ne",
      "lt",
      "le",
      "gt",
      "ge",
    ]);
    const silent: Operand = {
      type: "Name",
      value: ["event", "options", "silent"],
    };
    expect(opsFor(silent, "eq", names)).toEqual(["eq", "ne"]);
    const any: Operand = { type: "Name", value: ["vars", "bot", "any"] };
    expect(opsFor(any, "eq", names)).toContain("lt");
  });

  it("offers is set only for an optional name that has() can test", () => {
    const ratio: Operand = {
      type: "Name",
      value: ["event", "options", "ratio"],
    };
    expect(opsFor(ratio, "eq", names)).toEqual([
      "eq",
      "ne",
      "lt",
      "le",
      "gt",
      "ge",
      "set",
      "not_set",
    ]);
    const odd: Operand = {
      type: "Name",
      value: ["event", "options", "mi-opción"],
    };
    expect(opsFor(odd, "eq", names)).not.toContain("set");
    expect(canTestPresence(findName(names, odd.value)!)).toBe(false);
    expect(opsFor(id, "eq", names)).not.toContain("set");
  });

  it("always keeps the test the row has", () => {
    expect(opsFor(id, "lt", names)).toContain("lt");
    expect(opsFor(text("a"), "includes", names)).toContain("includes");
  });

  it("groups the names for a menu", () => {
    const groups = groupedNames(names);
    expect(groups.map((g) => g.group)).toEqual(["Event", "Step", "Variable"]);
    expect(groupedNames(null)).toEqual([]);
  });

  it("knows the kind of an operand", () => {
    expect(kindOf(id, names)).toBe("Text");
    expect(kindOf(text("a"), names)).toBe("Text");
    expect(kindOf({ type: "Integer", value: 1 }, names)).toBe("Integer");
    expect(kindOf({ type: "Decimal", value: 1 }, names)).toBe("Decimal");
    expect(kindOf({ type: "Boolean", value: true }, names)).toBe("Boolean");
    expect(
      kindOf({ type: "Name", value: ["steps", "gone", "x"] }, names),
    ).toBeNull();
  });
});

describe("a read that points at nothing", () => {
  const gone: Operand = {
    type: "Name",
    value: ["steps", "gone", "message_id"],
  };

  it("is missing when the list does not offer it", () => {
    expect(isMissing(gone, names)).toBe(true);
    expect(isMissing(id, names)).toBe(false);
    expect(isMissing(text("steps.gone"), names)).toBe(false);
    expect(isMissing(gone, null)).toBe(false);
    expect(rowIsMissing({ ...compare, right: gone }, names)).toBe(true);
    expect(rowIsMissing(compare, names)).toBe(false);
  });

  it("is not reported for steps and error where the order of the flow is not known", () => {
    const unknown: NameList = {
      order_known: false,
      names: names.names.filter((n) => n.group === "Event"),
    };
    expect(isMissing(gone, unknown)).toBe(false);
    expect(isMissing({ type: "Name", value: ["error", "kind"] }, unknown)).toBe(
      false,
    );
    expect(
      isMissing({ type: "Name", value: ["event", "nope", "x"] }, unknown),
    ).toBe(true);
  });
});

describe("the rows of a condition", () => {
  it("starts from the first name offered", () => {
    expect(newRow(names)).toEqual({
      type: "Compare",
      left: id,
      op: "Eq",
      right: text(""),
    });
    expect(newRow({ order_known: true, names: [] })).toBeNull();
    expect(newRow(null)).toBeNull();
  });

  it("adds, replaces and removes rows", () => {
    const one = addRow(null, names)!;
    expect(one.join).toBe("All");
    expect(one.rows).toHaveLength(1);
    const two = addRow(one, names)!;
    expect(two.rows).toHaveLength(2);
    expect(replaceRow(two, 1, compare).rows[1]).toBe(compare);
    expect(removeRow(two, 0)?.rows).toHaveLength(1);
    expect(removeRow(one, 0)).toBeNull();
    expect(addRow(null, { order_known: true, names: [] })).toBeNull();
  });

  it("stops at the most rows", () => {
    let condition: Condition | null = null;
    for (let i = 0; i < MAX_ROWS + 3; i += 1)
      condition = addRow(condition, names);
    expect(condition?.rows).toHaveLength(MAX_ROWS);
    expect(addRow(condition, names)).toBe(condition);
  });

  it("keeps a condition of one row as all", () => {
    const one = addRow(null, names)!;
    expect(withJoin(one, "Any").join).toBe("All");
    const two = addRow(one, names)!;
    expect(withJoin(two, "Any").join).toBe("Any");
  });
});
