/**
 * The undo history of a document: plain data and pure functions, so it is tested without a
 * browser. `T` is the document (the project); a state is never changed, only replaced, so a step
 * keeps the old one by reference.
 */

/** The most steps kept; the oldest is dropped past it. */
export const MAX_STEPS = 200;

/** A state to go back to and the flow the edit that left it touched, so the editor can show it. */
export interface Step<T> {
  readonly state: T;
  readonly flow: string | null;
}

export interface History<T> {
  readonly present: T;
  /** The states before the present one, oldest first. */
  readonly past: readonly Step<T>[];
  /** The states undone, the next redo last. */
  readonly future: readonly Step<T>[];
  /** The key of the last edit, so the next edit with the same key joins its step. */
  readonly lastKey: string | null;
}

export interface Edit {
  /** The flow the edit touches, or `null` for the project as a whole. */
  readonly flow: string | null;
  /** Edits in a row with the same key (typing in one field) are one step; `null` never joins. */
  readonly key?: string | null;
}

export function createHistory<T>(present: T): History<T> {
  return { present, past: [], future: [], lastKey: null };
}

/** Records `next` as the new present. A state that is the same one changes nothing. */
export function record<T>(
  history: History<T>,
  next: T,
  edit: Edit,
): History<T> {
  if (next === history.present) return history;
  const key = edit.key ?? null;
  if (key !== null && key === history.lastKey && history.past.length > 0) {
    // Joins the step before it: the state to go back to stays, the present moves on.
    return { ...history, present: next, future: [] };
  }
  const past = [...history.past, { state: history.present, flow: edit.flow }];
  return {
    present: next,
    past: past.length > MAX_STEPS ? past.slice(past.length - MAX_STEPS) : past,
    future: [],
    lastKey: key,
  };
}

/** Closes the step in progress: the next edit starts a new one even with the same key. */
export function seal<T>(history: History<T>): History<T> {
  return history.lastKey === null ? history : { ...history, lastKey: null };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/** Goes one step back; `flow` is the flow that step touched. */
export function undo<T>(history: History<T>): {
  readonly history: History<T>;
  readonly flow: string | null;
} {
  const step = history.past[history.past.length - 1];
  if (step === undefined) return { history, flow: null };
  return {
    flow: step.flow,
    history: {
      present: step.state,
      past: history.past.slice(0, -1),
      future: [...history.future, { state: history.present, flow: step.flow }],
      lastKey: null,
    },
  };
}

/** Goes one step forward; `flow` is the flow that step touched. */
export function redo<T>(history: History<T>): {
  readonly history: History<T>;
  readonly flow: string | null;
} {
  const step = history.future[history.future.length - 1];
  if (step === undefined) return { history, flow: null };
  return {
    flow: step.flow,
    history: {
      present: step.state,
      past: [...history.past, { state: history.present, flow: step.flow }],
      future: history.future.slice(0, -1),
      lastKey: null,
    },
  };
}
