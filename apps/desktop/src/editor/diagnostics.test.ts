import { describe, expect, it } from "vitest";
import type { DiagnosticView } from "../lib/bindings";
import {
  NO_MARKS,
  fieldKey,
  forField,
  groupDiagnostics,
  hasError,
  insideField,
  lineIndex,
  ofNode,
  totals,
} from "./diagnostics";
import { ping } from "./fixtures";

function diag(over: Partial<DiagnosticView>): DiagnosticView {
  return {
    flow: "ping",
    node: null,
    path: null,
    code: "x",
    severity: "error",
    message: "m",
    ...over,
  };
}

describe("totals", () => {
  it("counts errors and warnings of every flow", () => {
    const list = [
      diag({}),
      diag({ flow: "other" }),
      diag({ flow: null, severity: "warning" }),
    ];
    expect(totals(list)).toEqual({ errors: 2, warnings: 1 });
    expect(totals([])).toEqual({ errors: 0, warnings: 0 });
  });
});

describe("groupDiagnostics", () => {
  const content = diag({ node: "n2", path: "content" });
  const whole = diag({ node: "n2", code: "unreachable-node" });
  const line = diag({ node: "n1", path: "lines[0]" });

  it("puts each diagnostic where the editor marks it", () => {
    const marks = groupDiagnostics([content, whole, line], "ping", ping);
    expect(marks.fields.get(fieldKey("n2", "content"))).toEqual([content]);
    expect(marks.nodes.get("n2")).toEqual([whole]);
    expect(marks.lines.get("n1:next->n2")).toEqual([line]);
  });

  it("leaves out another flow and what has no node", () => {
    const marks = groupDiagnostics(
      [
        diag({ flow: "other", node: "n2", path: "content" }),
        diag({ node: null }),
        diag({ flow: null }),
      ],
      "ping",
      ping,
    );
    expect(marks.fields.size + marks.nodes.size + marks.lines.size).toBe(0);
  });

  it("leaves out a node, a field of a node and a line that are not there", () => {
    const marks = groupDiagnostics(
      [
        diag({ node: "gone", path: "content" }),
        diag({ node: "gone" }),
        diag({ node: "n1", path: "lines[9]" }),
      ],
      "ping",
      ping,
    );
    expect(marks.fields.size + marks.nodes.size + marks.lines.size).toBe(0);
  });

  it("has no marks without a flow", () => {
    expect(groupDiagnostics([content], null, ping)).toBe(NO_MARKS);
    expect(groupDiagnostics([content], "ping", null)).toBe(NO_MARKS);
  });
});

describe("fields", () => {
  const exact = diag({ node: "n1", path: "options[0].name" });
  const other = diag({ node: "n1", path: "options[1].name" });
  const list = diag({ node: "n1", path: "options" });
  const similar = diag({ node: "n1", path: "optionsx" });
  const marks = groupDiagnostics([exact, other, list, similar], "ping", ping);

  it("marks the exact field, not the whole list", () => {
    expect(forField(marks, "n1", "options[0].name")).toEqual([exact]);
    expect(forField(marks, "n1", "options[0]")).toEqual([]);
    expect(forField(marks, "n1", "options")).toEqual([list]);
  });

  it("finds what is inside a list, and only that", () => {
    expect(insideField(marks, "n1", "options")).toEqual([exact, other]);
    expect(insideField(marks, "n1", "options[0]")).toEqual([exact]);
    expect(insideField(marks, "n2", "options")).toEqual([]);
  });

  it("lists every diagnostic of a node", () => {
    const whole = diag({ node: "n1", code: "cycle" });
    const all = groupDiagnostics([exact, whole], "ping", ping);
    expect(ofNode(all, "n1")).toHaveLength(2);
    expect(ofNode(all, "n2")).toEqual([]);
  });
});

describe("lineIndex and hasError", () => {
  it("reads only a line path", () => {
    expect(lineIndex("lines[12]")).toBe(12);
    for (const path of [
      "lines",
      "lines[]",
      "lines[1].x",
      "xlines[1]",
      null,
      undefined,
    ]) {
      expect(lineIndex(path), String(path)).toBeNull();
    }
  });

  it("tells an error from a warning", () => {
    expect(hasError([diag({ severity: "warning" })])).toBe(false);
    expect(hasError([diag({ severity: "warning" }), diag({})])).toBe(true);
    expect(hasError([])).toBe(false);
  });
});
