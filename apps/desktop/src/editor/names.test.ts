import { describe, expect, it } from "vitest";
import {
  isAlias,
  isFlowName,
  newAlias,
  newFlowName,
  newNodeId,
  type Random,
} from "./names";

/** A generator that answers the same list again and again. */
function cycle(...values: number[]): Random {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("flow names", () => {
  it("accepts what Rust accepts", () => {
    for (const name of ["ping", "a", "0day", "my-flow_2", "a".repeat(64)]) {
      expect(isFlowName(name), name).toBe(true);
    }
  });

  it("refuses what Rust refuses", () => {
    for (const name of [
      "",
      "Ping",
      "-a",
      "_a",
      "a b",
      "a.b",
      "ñ",
      "a".repeat(65),
      "a\n",
    ]) {
      expect(isFlowName(name), name).toBe(false);
    }
  });

  it("makes a free name", () => {
    expect(newFlowName(new Set())).toBe("flow");
    expect(newFlowName(new Set(["flow", "flow_2"]))).toBe("flow_3");
  });
});

describe("node ids", () => {
  it("uses the allowed characters and length", () => {
    const id = newNodeId(new Set());
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("never repeats a taken id", () => {
    // The first id the generator makes is taken, so the second must be used.
    const first = newNodeId(new Set(), cycle(0));
    const next = newNodeId(
      new Set([first]),
      cycle(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5),
    );
    expect(next).not.toBe(first);
  });
});

describe("aliases", () => {
  it("comes from the end of the type", () => {
    expect(newAlias("discord.slash_command", new Set())).toBe("slash_command");
    expect(newAlias("logic.branch", new Set())).toBe("branch");
  });

  it("adds a number when the alias is taken", () => {
    const taken = new Set(["reply", "reply_2"]);
    expect(newAlias("discord.reply", taken)).toBe("reply_3");
  });

  it("stays a valid alias for odd type ids", () => {
    const valid = /^[a-z_][a-z0-9_]{0,63}$/;
    for (const type of [
      "x.9lives",
      "x.Big-Name",
      "",
      "a.",
      "x." + "b".repeat(80),
    ]) {
      expect(newAlias(type, new Set()), type).toMatch(valid);
    }
  });

  it("keeps the limit when the base is long and taken", () => {
    const base = "b".repeat(64);
    const alias = newAlias(`x.${base}`, new Set([base]));
    expect(alias).toHaveLength(64);
    expect(alias.endsWith("_2")).toBe(true);
  });
});

describe("isAlias", () => {
  it("accepts and refuses what Rust does", () => {
    for (const alias of ["a", "_a", "reply_2", "a".repeat(64)]) {
      expect(isAlias(alias), alias).toBe(true);
    }
    for (const alias of [
      "",
      "9a",
      "Reply",
      "a-b",
      "a b",
      "a.b",
      "ñ",
      "a".repeat(65),
      "a\n",
    ]) {
      expect(isAlias(alias), alias).toBe(false);
    }
  });
});
