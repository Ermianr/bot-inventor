import { describe, expect, it } from "vitest";
import type { LogLine } from "../lib/bindings";
import {
  appendLines,
  atEnd,
  clearLog,
  defaultBotName,
  emptyLog,
  formatTime,
  MAX_LOG_LINES,
  where,
} from "./logs";

function line(msg: string, extra: Partial<LogLine> = {}): LogLine {
  return {
    ts: "2026-10-24T10:11:12.345Z",
    level: "info",
    source: "engine",
    run: null,
    flow: null,
    node: null,
    msg,
    ...extra,
  };
}

describe("appendLines", () => {
  it("adds lines in order with numbers that grow", () => {
    const one = appendLines(emptyLog, [line("a"), line("b")]);
    const two = appendLines(one, [line("c")]);
    expect(two.entries.map((e) => e.line.msg)).toEqual(["a", "b", "c"]);
    expect(two.entries.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(two.dropped).toBe(0);
    expect(two.next).toBe(3);
  });

  it("changes nothing for no lines, and never changes what it was given", () => {
    const one = appendLines(emptyLog, [line("a")]);
    expect(appendLines(one, [])).toBe(one);
    appendLines(one, [line("b")]);
    expect(one.entries).toHaveLength(1);
  });

  it("keeps the last lines and counts the dropped ones", () => {
    const burst = Array.from({ length: 12_000 }, (_, i) => line(String(i)));
    const log = appendLines(emptyLog, burst);
    expect(log.entries).toHaveLength(MAX_LOG_LINES);
    expect(log.entries[0]?.line.msg).toBe(String(12_000 - MAX_LOG_LINES));
    expect(log.entries.at(-1)?.line.msg).toBe("11999");
    expect(log.dropped).toBe(12_000 - MAX_LOG_LINES);
    expect(log.next).toBe(12_000);
    const more = appendLines(log, [line("x"), line("y")]);
    expect(more.entries).toHaveLength(MAX_LOG_LINES);
    expect(more.dropped).toBe(12_000 - MAX_LOG_LINES + 2);
    expect(more.entries.at(-1)?.seq).toBe(12_001);
  });

  it("works with a small limit", () => {
    const log = appendLines(emptyLog, [line("a"), line("b"), line("c")], 2);
    expect(log.entries.map((e) => e.line.msg)).toEqual(["b", "c"]);
    expect(log.dropped).toBe(1);
  });

  it("clears the lines and keeps the numbers going", () => {
    const log = clearLog(appendLines(emptyLog, [line("a"), line("b")]));
    expect(log.entries).toEqual([]);
    expect(log.dropped).toBe(0);
    expect(appendLines(log, [line("c")]).entries[0]?.seq).toBe(2);
  });
});

describe("what a row shows", () => {
  it("takes the time of day from the stamp", () => {
    expect(formatTime("2026-10-24T10:11:12.345Z")).toBe("10:11:12.345");
    expect(formatTime("2026-10-24T10:11:12Z")).toBe("10:11:12");
    expect(formatTime(null)).toBe("");
    expect(formatTime("yesterday")).toBe("");
    expect(formatTime("<b>x</b>")).toBe("");
  });

  it("says where a line comes from", () => {
    expect(where(line("a"))).toBe("");
    expect(where(line("a", { flow: "ping" }))).toBe("ping");
    expect(where(line("a", { node: "reply" }))).toBe("reply");
    expect(where(line("a", { flow: "ping", node: "reply" }))).toBe(
      "ping / reply",
    );
  });

  it("knows when a scroll position is at the end", () => {
    expect(atEnd(900, 1000, 100)).toBe(true);
    expect(atEnd(880, 1000, 100)).toBe(true);
    expect(atEnd(500, 1000, 100)).toBe(false);
    expect(atEnd(0, 50, 100)).toBe(true);
  });
});

describe("defaultBotName", () => {
  it("makes a plain file name from the name of the project", () => {
    expect(defaultBotName("My bot")).toBe("my-bot");
    expect(defaultBotName("  Ping!  ")).toBe("ping");
    expect(defaultBotName("Mi bot ñandú")).toBe("mi-bot-nandu");
    expect(defaultBotName("../etc/passwd")).toBe("etc-passwd");
    expect(defaultBotName("a_b-c")).toBe("a_b-c");
  });

  it("never offers a name the exporter refuses", () => {
    for (const name of ["", "   ", "...", "-x", "assets", "Data", "日本語"]) {
      const offered = defaultBotName(name);
      expect(offered).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
      expect(["assets", "data"]).not.toContain(offered);
    }
    expect(defaultBotName("x".repeat(100))).toHaveLength(64);
  });
});
