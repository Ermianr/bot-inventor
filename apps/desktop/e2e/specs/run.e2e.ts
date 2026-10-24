import { $, browser, expect } from "@wdio/globals";
import {
  backend,
  createProject,
  field,
  fill,
  notice,
  select,
  start,
  waitForProblems,
} from "../support/editor";
import {
  openPing,
  flood,
  line,
  logMessages,
  running,
  send,
  startBot,
  violations,
  waitForLog,
  waitForRunState,
} from "../support/run";

const run = () => $("button=Run");
const stop = () => $("button=Stop");

describe("running the bot", () => {
  beforeEach(async () => {
    await start();
    await openPing();
  });

  it("goes from starting to running, shows the lines as they come, and stops", async () => {
    await expect(run()).toBeEnabled();
    await expect(stop()).toBeDisabled();
    await waitForRunState("Not running");
    // The log stays out of the way while the bot is edited, and opens when it starts.
    await expect($("[role='log']")).not.toBeDisplayed();

    await run().click();
    await expect($("[role='log']")).toBeDisplayed();
    await waitForRunState("Starting…");
    await expect(run()).toBeDisabled();

    await send(
      running,
      line("connected"),
      line("careful", { level: "warn", flow: "main", node: "reply" }),
      line("broken", { level: "error" }),
    );
    await waitForRunState("Running");
    await waitForLog(3);
    expect(await logMessages()).toEqual(["connected", "careful", "broken"]);
    await expect(stop()).toBeEnabled();

    // The level is a word, not only a colour, and a line says where it comes from.
    const rows = await $$("[role='log'] .row");
    await expect(rows[1]?.$(".level")).toHaveText("WARN");
    await expect(rows[1]?.$(".where")).toHaveText("main / reply");
    await expect(rows[2]?.$(".level")).toHaveText("ERROR");
    await expect(rows[0]?.$("time")).toHaveText("10:11:12.345");

    await stop().click();
    await waitForRunState("Stopped");
    await expect(run()).toBeEnabled();
    await expect(stop()).toBeDisabled();
    expect(await violations()).toEqual([]);
  });

  it("tells a configuration problem with the error line of the runner", async () => {
    await startBot();
    await send(
      line("error: no .env file: write the token in Bot settings", {
        level: "error",
      }),
      {
        kind: "status",
        data: {
          state: "exited",
          code: 2,
          signal: null,
          reason: "configuration",
          requested: false,
        },
      },
    );
    await waitForRunState(
      "Stopped unexpectedly: Configuration problem (exit code 2); see the log",
    );
    expect(await logMessages()).toEqual([
      "error: no .env file: write the token in Bot settings",
    ]);
    await expect($(".app > header .run-state")).toHaveElementClass("failing");
    await expect(run()).toBeEnabled();
  });

  it("tells an exit nobody asked for, and runs again", async () => {
    await startBot();
    await send(running, line("first run"), {
      kind: "status",
      data: {
        state: "exited",
        code: null,
        signal: 9,
        reason: "signal",
        requested: false,
      },
    });
    await waitForRunState("Stopped unexpectedly: Ended by signal 9");

    await run().click();
    await waitForRunState("Starting…");
    // A new run starts with an empty log.
    expect(await logMessages()).toEqual([]);
  });

  it("takes a flood of lines without losing order or freezing", async () => {
    await startBot();
    await send(running);
    await flood(2000);
    await waitForLog(2000);
    const shown = await logMessages();
    expect(shown[0]).toBe("line 0");
    expect(shown[1999]).toBe("line 1999");

    await flood(4000);
    await browser.waitUntil(
      async () =>
        (await $(".log .note").isExisting()) &&
        (await $(".log .note").getText()).includes("earlier lines"),
    );
    const capped = await logMessages();
    expect(capped).toHaveLength(5000);
    expect(capped.at(-1)).toBe("line 3999");
    await expect($(".log .note")).toHaveText(
      "1000 earlier lines were dropped.",
    );
  });

  it("follows the newest line until the person scrolls up", async () => {
    await startBot();
    await send(running);
    await flood(300);
    await waitForLog(300);
    const atEnd = () =>
      browser.execute(() => {
        const el = document.querySelector("[role='log']");
        return el === null
          ? false
          : el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      });
    await browser.waitUntil(atEnd);

    await browser.execute(() => {
      const el = document.querySelector("[role='log']");
      if (el !== null) el.scrollTop = 0;
    });
    await $("button=Jump to latest").waitForExist();
    await flood(50);
    await waitForLog(350);
    expect(await atEnd()).toBe(false);

    await $("button=Jump to latest").click();
    await browser.waitUntil(atEnd);
    await expect($("button=Jump to latest")).not.toExist();
  });

  it("shows text as text, whatever a line says", async () => {
    await startBot();
    await send(
      running,
      line('<img src=x onerror="window.__pwned = 1">{{ 1 + 1 }}'),
    );
    await waitForLog(1);
    expect(await logMessages()).toEqual([
      '<img src=x onerror="window.__pwned = 1">{{ 1 + 1 }}',
    ]);
    expect(await $$("[role='log'] img")).toHaveLength(0);
    expect(
      await browser.execute(() => (window as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });

  it("clears the log and collapses the panel", async () => {
    await startBot();
    await send(running, line("a"), line("b"));
    await waitForLog(2);
    await $("button=Clear").click();
    await waitForLog(0);
    await expect($(".log .count")).toHaveText("0 lines");

    await $("button=Collapse the log").click();
    await expect($("[role='log']")).not.toBeDisplayed();
    await $("button=Expand the log").click();
    await expect($("[role='log']")).toBeDisplayed();
  });

  it("does not run a project with an error, and runs it again once it is fixed", async () => {
    await select("reply");
    // Select the text and delete it, as a person would.
    await (await field("Message")).click();
    await browser.keys(["Control", "a"]);
    await browser.keys(["Backspace"]);
    await waitForProblems("Errors: 1 · Warnings: 0");
    await expect(run()).toBeDisabled();
    await expect(run()).toHaveAttribute(
      "title",
      "Fix the errors of the project first.",
    );
    expect((await backend()).calls.some((c) => c.cmd === "start_bot")).toBe(
      false,
    );

    await fill("Message", "Pong!");
    await waitForProblems("No problems");
    await expect(run()).toBeEnabled();
  });

  it("does not let the project be replaced while the bot runs", async () => {
    await run().click();
    await waitForRunState("Starting…");
    await expect($("button=New project")).toBeDisabled();
    await expect($("button=Open project")).toBeDisabled();

    await send(running, {
      kind: "status",
      data: {
        state: "exited",
        code: 0,
        signal: null,
        reason: "clean",
        requested: true,
      },
    });
    await waitForRunState("Stopped");
    await expect($("button=New project")).toBeEnabled();
    await expect($("button=Open project")).toBeEnabled();
    expect(await notice()).toBeNull();
  });

  it("runs and stops with the keyboard alone", async () => {
    // A person tabs to the button; the test puts the focus there and then uses only keys.
    await browser.execute(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Run")
        ?.focus();
    });
    await browser.keys(["Enter"]);
    await waitForRunState("Starting…");
    await send(running);
    await waitForRunState("Running");
    // Stop is the next control after Run in the tab order.
    await browser.keys(["Tab"]);
    await browser.keys(["Enter"]);
    await waitForRunState("Stopped");
  });
});

describe("running without a project", () => {
  it("is disabled until a project is open", async () => {
    await start();
    await expect($("button=Run")).not.toExist();
    await createProject();
    await expect($("button=Run")).toBeDisabled();
  });
});
