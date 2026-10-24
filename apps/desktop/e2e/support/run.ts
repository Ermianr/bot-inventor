/** What the specs of running and exporting do again and again. */

import { $, browser } from "@wdio/globals";
import type { LogLine, RunEvent } from "../../src/lib/bindings";
import type { Project } from "../../src/lib/bindings";
import { answerOpen, waitForAliases, waitForProblems } from "./editor";

/** Ping as the editor saves it: the nodes are where a person would put them. */
const pingProject: Project = {
  manifest: {
    format_version: 1,
    name: "My bot",
    platform: "discord",
    settings: {},
    variables: [],
  },
  flows: {
    main: {
      nodes: [
        {
          id: "n1",
          alias: "slash_command",
          type: "discord.slash_command",
          type_version: 1,
          settings: { name: "ping", description: "Replies with pong" },
          editor: { x: 0, y: 0 },
        },
        {
          id: "n2",
          alias: "reply",
          type: "discord.reply",
          type_version: 1,
          settings: { content: "Pong!" },
          editor: { x: 320, y: 0 },
        },
      ],
      lines: [{ from: { node: "n1", port: "next" }, to: "n2" }],
    },
  },
};

/**
 * Opens Ping, which has no problem. The specs of running and exporting open it instead of
 * building it, so they do not depend on where a drag lands; `build-ping.e2e.ts` builds it.
 */
export async function openPing(): Promise<void> {
  await answerOpen(pingProject);
  await $("button=Open project").click();
  await $(".app > header .project").waitForExist();
  await waitForAliases(["slash_command", "reply"]);
  await waitForProblems("No problems");
}

export const line = (msg: string, over: Partial<LogLine> = {}): RunEvent => ({
  kind: "log",
  data: {
    ts: "2026-10-24T10:11:12.345Z",
    level: "info",
    source: "engine",
    run: null,
    flow: null,
    node: null,
    msg,
    ...over,
  },
});

export const running: RunEvent = {
  kind: "status",
  data: { state: "running" },
};

/** Sends an event to the page, as Rust would through the channel. */
export async function send(...events: RunEvent[]): Promise<void> {
  await browser.execute((list) => {
    for (const event of list) window.__e2e.send(event);
  }, events);
}

export async function flood(count: number): Promise<void> {
  await browser.execute((n) => {
    window.__e2e.flood(n);
  }, count);
}

/** The state of the bot next to the buttons. */
export async function runState(): Promise<string> {
  return $(".app > header .run-state").getText();
}

export async function waitForRunState(text: string): Promise<void> {
  await browser.waitUntil(async () => (await runState()) === text, {
    timeoutMsg: `the state never became "${text}"; it is "${await runState()}"`,
  });
}

/** The messages of the log, in order, read in one call so a long log is not slow to read. */
export async function logMessages(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll("[role='log'] .msg"),
      (el) => el.textContent,
    ),
  );
}

export async function waitForLog(count: number): Promise<void> {
  await browser.waitUntil(async () => (await logMessages()).length === count, {
    timeoutMsg: `the log never had ${count} lines; it has ${(await logMessages()).length}`,
  });
}

/** Everything a person could read in the page, and what its attributes and storage hold. */
export async function everythingShown(): Promise<string> {
  return browser.execute(() => {
    const parts: string[] = [document.documentElement.outerHTML];
    for (const input of document.querySelectorAll("input")) {
      parts.push(input.value);
    }
    try {
      parts.push(JSON.stringify({ ...localStorage }));
      parts.push(JSON.stringify({ ...sessionStorage }));
    } catch {
      // Storage may be unavailable; the page works without it.
    }
    parts.push(location.href);
    return parts.join("\n");
  });
}

export async function violations(): Promise<string[]> {
  return browser.execute(() => window.__e2e.violations);
}

/**
 * Presses Run and waits until the bot has started, so what is sent next reaches the channel that
 * Rust opened for it.
 */
export async function startBot(): Promise<void> {
  await $("button=Run").click();
  await waitForRunState("Starting…");
}
