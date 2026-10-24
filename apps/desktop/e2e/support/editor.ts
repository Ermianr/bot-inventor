/** What the specs do again and again, in the words a person would use. */

import { $, $$, browser, expect } from "@wdio/globals";
import type { Project } from "../../src/lib/bindings";
import type { E2eState } from "../fakeBackend";

/** Loads the app on the fake backend. */
export async function start(): Promise<void> {
  await browser.url("/e2e/index.html");
  await $("h1").waitForExist();
}

/** The state of the fake backend, as plain data. */
export async function backend(): Promise<
  Pick<E2eState, "calls" | "saved" | "violations">
> {
  return browser.execute(() => {
    const { calls, saved, violations } = window.__e2e;
    return { calls, saved, violations };
  });
}

/** What the folder dialog answers to Open project; `null` cancels it. */
export async function answerOpen(project: Project | null): Promise<void> {
  await browser.execute((opened) => {
    window.__e2e.openResult =
      opened === null ? null : { project: opened, migrated_from: null };
  }, project);
}

export async function createProject(name = "My bot"): Promise<void> {
  await $("button=New project").click();
  const input = await $("aria/Project name");
  await input.setValue(name);
  await $("button=Choose an empty folder…").click();
  await $(".app > header .project").waitForExist();
  await expect($(".app > header .project")).toHaveText(name);
}

/** Adds a node from the palette and returns its alias. */
export async function addNode(label: string): Promise<string> {
  const before = await aliases();
  await $('section[aria-label="Add a node"]').$(`button=${label}`).click();
  await browser.waitUntil(
    async () => (await aliases()).length === before.length + 1,
  );
  const after = await aliases();
  const added = after.find((alias) => !before.includes(alias));
  if (added === undefined) throw new Error("the node was not added");
  return added;
}

export async function aliases(): Promise<string[]> {
  const texts: string[] = [];
  for (const el of await $$(".svelte-flow__node .alias")) {
    // `getText` gives an empty text for a node that Svelte Flow has not measured yet and so keeps
    // hidden; the text itself is already there.
    texts.push(String(await el.getProperty("textContent")));
  }
  return texts;
}

/** The element of the node with this alias. */
export function node(alias: string): ReturnType<typeof $> {
  return $(
    `//div[contains(concat(' ', normalize-space(@class), ' '), ' svelte-flow__node ')][.//p[contains(@class,'alias') and normalize-space()='${alias}']]`,
  );
}

/** Selects a node by clicking its alias. */
export async function select(alias: string): Promise<void> {
  const title = node(alias).$(".alias");
  await title.waitForDisplayed();
  await settled(title);
  await title.click();
  await $("aside[aria-label='Properties'] input[id^='alias-']").waitForExist();
}

/** Waits until an element stops moving: the canvas animates when it is first drawn and fitted. */
async function settled(element: ReturnType<typeof $>): Promise<void> {
  let last = "";
  await browser.waitUntil(
    async () => {
      const at = await element.getLocation();
      const now = `${at.x},${at.y}`;
      const same = now === last;
      last = now;
      await browser.pause(60);
      return same;
    },
    { timeoutMsg: "the element never stopped moving" },
  );
}

/**
 * Presses on an element, moves the pointer in a few steps and releases it. Svelte Flow reacts to
 * the moves in between, which the single jump of `dragAndDrop` does not give it.
 */
async function pointerDrag(
  from: ReturnType<typeof $>,
  to: { x: number; y: number } | ReturnType<typeof $>,
): Promise<void> {
  await from.waitForDisplayed();
  await settled(from);
  const start = await from.getLocation();
  const size = await from.getSize();
  const origin = { x: start.x + size.width / 2, y: start.y + size.height / 2 };
  let target: { x: number; y: number };
  if ("x" in to && typeof to.x === "number") {
    target = { x: origin.x + to.x, y: origin.y + to.y };
  } else {
    const element = to as ReturnType<typeof $>;
    const at = await element.getLocation();
    const box = await element.getSize();
    target = { x: at.x + box.width / 2, y: at.y + box.height / 2 };
  }
  const steps = 6;
  const pointer = browser
    .action("pointer")
    .move({ x: Math.round(origin.x), y: Math.round(origin.y) })
    .down();
  for (let i = 1; i <= steps; i++) {
    pointer.move({
      x: Math.round(origin.x + ((target.x - origin.x) * i) / steps),
      y: Math.round(origin.y + ((target.y - origin.y) * i) / steps),
    });
  }
  await pointer.up().perform();
}

/** Moves a node by dragging its alias. */
export async function drag(alias: string, x: number, y: number): Promise<void> {
  await node(alias).$(".alias").waitForDisplayed();
  await pointerDrag(node(alias).$(".alias"), { x, y });
}

/** Draws a line from an output port of one node to the input of another. */
export async function connect(
  from: string,
  port: string,
  to: string,
): Promise<void> {
  const handle = node(from).$(`.svelte-flow__handle[data-handleid='${port}']`);
  await pointerDrag(handle, node(to).$(".svelte-flow__handle.target"));
}

/** Releases a line from an output port on the body of a node, not on a port. */
export async function dropOnNode(
  from: string,
  port: string,
  to: string,
): Promise<void> {
  const handle = node(from).$(`.svelte-flow__handle[data-handleid='${port}']`);
  await pointerDrag(handle, node(to));
}

export async function field(label: string): Promise<ReturnType<typeof $>> {
  return $("aside[aria-label='Properties']").$(`aria/${label}`);
}

export async function fill(label: string, text: string): Promise<void> {
  await (await field(label)).setValue(text);
}

/** The text of the problems count in the toolbar. */
export async function problems(): Promise<string> {
  return $(".app > header .problems").getText();
}

/** Waits for validation (300 ms after the last change) to show this text in the toolbar. */
export async function waitForProblems(text: string): Promise<void> {
  await browser.waitUntil(async () => (await problems()) === text, {
    timeoutMsg: `the toolbar never said "${text}"; it says "${await problems()}"`,
  });
}

export async function edgeCount(): Promise<number> {
  return (await $$(".svelte-flow__edge")).length;
}

/** The panel on the right. */
export function panel(): ReturnType<typeof $> {
  return $("aside[aria-label='Properties']");
}

/** A field inside one row of a list in the panel (the first row is 0). */
export async function rowField(
  row: number,
  label: string,
): Promise<ReturnType<typeof $>> {
  const rows = await panel().$$("fieldset");
  const found = rows[row];
  if (found === undefined) throw new Error(`the panel has no row ${row}`);
  return found.$(`aria/${label}`);
}

/** The problem messages shown in the panel, in order. */
export async function panelMessages(): Promise<string[]> {
  const texts: string[] = [];
  for (const el of await panel().$$(".problem")) texts.push(await el.getText());
  return texts;
}

/** The number on a node (its problems), or `null` when it has none. */
export async function badge(alias: string): Promise<string | null> {
  const el = node(alias).$(".problems");
  return (await el.isExisting()) ? el.getText() : null;
}

/** Waits until validation has settled on this node's badge. */
export async function waitForBadge(
  alias: string,
  expected: string | null,
): Promise<void> {
  await browser.waitUntil(async () => (await badge(alias)) === expected, {
    timeoutMsg: `the badge of ${alias} never became ${String(expected)}`,
  });
}

export async function press(...keys: string[]): Promise<void> {
  await browser.keys(keys);
}

/** The status next to the project name: `Saved` or `Unsaved changes`. */
export async function status(): Promise<string> {
  return $(".app > header .status").getText();
}

export async function notice(): Promise<string | null> {
  const el = $("[role='alert']");
  return (await el.isExisting()) ? el.$("span").getText() : null;
}

/** Waits until the canvas draws exactly this many lines. */
export async function waitForEdges(count: number): Promise<void> {
  await browser.waitUntil(async () => (await edgeCount()) === count, {
    timeoutMsg: `the canvas never drew ${count} lines; it draws ${await edgeCount()}`,
  });
}

/**
 * Waits until the canvas shows exactly these aliases, in this order. A node is hidden until Svelte
 * Flow has measured it, so reading the page right after a change can give empty text.
 */
export async function waitForAliases(
  expected: readonly string[],
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const shown = await aliases();
      return (
        shown.length === expected.length &&
        shown.every((a, i) => a === expected[i])
      );
    },
    {
      timeoutMsg: `the canvas never showed [${expected.join(", ")}]; it shows [${(await aliases()).join(", ")}]`,
    },
  );
}
