import { describe, expect, it } from "vitest";
import {
  MAX_STEPS,
  canRedo,
  canUndo,
  createHistory,
  record,
  redo,
  seal,
  undo,
  type History,
} from "./history";

/** A history of numbers: each edit sets the number. */
function run(values: number[], key: string | null = null): History<number> {
  let history = createHistory(0);
  for (const value of values)
    history = record(history, value, { flow: "f", key });
  return history;
}

describe("record", () => {
  it("makes one step per edit", () => {
    const history = run([1, 2, 3]);
    expect(history.present).toBe(3);
    expect(history.past.map((s) => s.state)).toEqual([0, 1, 2]);
  });

  it("ignores an edit that changes nothing", () => {
    const history = run([1]);
    expect(record(history, 1, { flow: "f" })).toBe(history);
  });

  it("joins the edits that share a key into one step", () => {
    const history = run([1, 2, 3], "typing");
    expect(history.present).toBe(3);
    expect(history.past.map((s) => s.state)).toEqual([0]);
    expect(undo(history).history.present).toBe(0);
  });

  it("starts a new step for another key, or for no key", () => {
    let history = record(createHistory(0), 1, { flow: "f", key: "a" });
    history = record(history, 2, { flow: "f", key: "b" });
    history = record(history, 3, { flow: "f", key: null });
    history = record(history, 4, { flow: "f", key: null });
    expect(history.past.map((s) => s.state)).toEqual([0, 1, 2, 3]);
  });

  it("starts a new step after seal, even with the same key", () => {
    let history = run([1, 2], "a");
    history = seal(history);
    history = record(history, 3, { flow: "f", key: "a" });
    expect(history.past.map((s) => s.state)).toEqual([0, 2]);
  });

  it("starts a new step after an undo, even with the same key", () => {
    let history = run([1], "a");
    history = undo(history).history;
    history = redo(history).history;
    history = record(history, 2, { flow: "f", key: "a" });
    expect(history.past.map((s) => s.state)).toEqual([0, 1]);
  });

  it("empties the redo side", () => {
    let history = undo(run([1, 2])).history;
    expect(canRedo(history)).toBe(true);
    history = record(history, 9, { flow: null });
    expect(canRedo(history)).toBe(false);
  });

  it("keeps at most MAX_STEPS steps and drops the oldest", () => {
    const history = run(
      Array.from({ length: MAX_STEPS + 50 }, (_, i) => i + 1),
    );
    expect(history.past).toHaveLength(MAX_STEPS);
    expect(history.past[0]?.state).toBe(50);
    let back = history;
    while (canUndo(back)) back = undo(back).history;
    expect(back.present).toBe(50);
  });
});

describe("undo and redo", () => {
  it("do nothing on an empty side", () => {
    const history = createHistory(5);
    expect(undo(history)).toEqual({ history, flow: null });
    expect(redo(history)).toEqual({ history, flow: null });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it("walk back and forth over the same states", () => {
    let history = run([1, 2, 3]);
    const seen: number[] = [];
    while (canUndo(history)) {
      history = undo(history).history;
      seen.push(history.present);
    }
    expect(seen).toEqual([2, 1, 0]);
    while (canRedo(history)) {
      history = redo(history).history;
      seen.push(history.present);
    }
    expect(seen.slice(3)).toEqual([1, 2, 3]);
  });

  it("say which flow the step touched", () => {
    let history = createHistory(0);
    history = record(history, 1, { flow: "a" });
    history = record(history, 2, { flow: "b" });
    const back = undo(history);
    expect(back.flow).toBe("b");
    expect(undo(back.history).flow).toBe("a");
    expect(redo(back.history).flow).toBe("b");
  });
});

describe("a long sequence", () => {
  // A small deterministic generator, so a failure repeats.
  function lcg(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 2 ** 32;
      return state / 2 ** 32;
    };
  }

  it("undone to the end gives the start, and redone to the end gives the end", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const random = lcg(seed);
      let history = createHistory(0);
      for (let i = 0; i < 150; i++) {
        const key = random() < 0.5 ? `k${Math.floor(random() * 3)}` : null;
        history = record(history, i + 1, { flow: "f", key });
        if (random() < 0.15) history = seal(history);
      }
      const end = history.present;
      while (canUndo(history)) history = undo(history).history;
      expect(history.present).toBe(0);
      while (canRedo(history)) history = redo(history).history;
      expect(history.present).toBe(end);
    }
  });
});
