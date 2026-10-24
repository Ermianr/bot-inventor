/** The log of the bot as the panel keeps it: pure functions, no state. */

import type { LogLine } from "../lib/bindings";

/** The panel keeps this many lines; older ones are dropped and counted. */
export const MAX_LOG_LINES = 5000;

/** A line with a number that never repeats, which is what the panel keys its rows by. */
export interface LogEntry {
  readonly seq: number;
  readonly line: LogLine;
}

export interface LogBuffer {
  readonly entries: readonly LogEntry[];
  /** How many earlier lines were dropped to stay within the limit. */
  readonly dropped: number;
  /** The number the next line gets. */
  readonly next: number;
}

export const emptyLog: LogBuffer = { entries: [], dropped: 0, next: 0 };

/** Adds lines at the end, in order, and keeps only the last `MAX_LOG_LINES`. */
export function appendLines(
  buffer: LogBuffer,
  lines: readonly LogLine[],
  limit: number = MAX_LOG_LINES,
): LogBuffer {
  if (lines.length === 0) return buffer;
  const added = lines.map((line, i): LogEntry => ({
    seq: buffer.next + i,
    line,
  }));
  const all =
    buffer.entries.length === 0 ? added : [...buffer.entries, ...added];
  const over = Math.max(0, all.length - limit);
  return {
    entries: over === 0 ? all : all.slice(over),
    dropped: buffer.dropped + over,
    next: buffer.next + lines.length,
  };
}

/** Empties the log but keeps the numbers going, so a row never gets a number twice. */
export function clearLog(buffer: LogBuffer): LogBuffer {
  return { entries: [], dropped: 0, next: buffer.next };
}

const TIME = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/;

/** The time of day of an RFC 3339 stamp, as written (UTC); empty for a line with no stamp. */
export function formatTime(ts: string | null): string {
  if (ts === null) return "";
  return TIME.exec(ts)?.[1] ?? "";
}

/** Where a line comes from: `flow / node`, whichever it has. */
export function where(line: LogLine): string {
  return [line.flow, line.node].filter((p) => p !== null).join(" / ");
}

/** Whether a scroll position is at the end, within a few pixels. */
export function atEnd(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slack = 24,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}

const MAX_NAME_BYTES = 64;

/**
 * A name for the exported file from the name of the project: lowercase letters, digits, dashes and
 * underscores. Rust checks the name that is finally used; this only offers a good start.
 */
export function defaultBotName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^[-_]+|-+$/g, "")
    .slice(0, MAX_NAME_BYTES)
    .replace(/-+$/g, "");
  return slug === "" || slug === "assets" || slug === "data" ? "bot" : slug;
}
