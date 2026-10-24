import { describe, expect, it } from "vitest";
import { sameValue } from "./equal";

describe("sameValue", () => {
  it("compares values, not references", () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue("x", "x")).toBe(true);
    expect(sameValue(null, null)).toBe(true);
  });

  it("ignores the order of keys but not of items", () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });

  it("tells different values apart", () => {
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(sameValue([], {})).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue(1, "1")).toBe(false);
    expect(sameValue({ a: undefined }, {})).toBe(false);
  });
});
