import { $, browser, expect } from "@wdio/globals";
import {
  backend,
  field,
  notice,
  select,
  start,
  waitForProblems,
} from "../support/editor";
import { openPing, everythingShown, violations } from "../support/run";

const MARKER = "MARKER-token.AbC_123-xyz";

/** The element that has the keyboard focus, by its text. */
async function focusedText(): Promise<string> {
  return browser.execute(
    () => document.activeElement?.textContent.trim() ?? "",
  );
}

describe("the token and the development server", () => {
  before(async () => {
    await start();
    await openPing();
  });

  it("saves a token and never shows it again", async () => {
    await $("button=Bot settings").click();
    await expect($("dialog[open]")).toBeDisplayed();
    await expect($("[role='status']=No token yet")).toExist();
    const input = $("#bot-token");
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect($("button=Save token")).toBeDisabled();

    await input.setValue(MARKER);
    await expect($("button=Save token")).toBeEnabled();
    await $("button=Save token").click();

    await $("[role='status']=A token is set").waitForExist();
    await expect($("[role='alert']=The token was saved.")).toExist();
    await expect(input).toHaveValue("");
    const shown = await everythingShown();
    expect(shown).not.toContain(MARKER);
    // The fake `.env` has it: it went to Rust and stopped there.
    expect(await browser.execute(() => window.__e2e.token)).toBe(MARKER);
  });

  it("sends the token with Enter, and the field is empty after an error too", async () => {
    const input = $("#bot-token");
    await input.setValue("not a valid token");
    await browser.keys(["Enter"]);
    await $("[role='alert']*=the token must have").waitForExist();
    await expect(input).toHaveValue("");
    expect(await everythingShown()).not.toContain("not a valid token");
    // The refused token changed nothing.
    expect(await browser.execute(() => window.__e2e.token)).toBe(MARKER);
  });

  it("saves, refuses and removes the development server", async () => {
    const guild = $("#dev-guild");
    await expect($("button=Remove")).toBeDisabled();
    await guild.setValue("12x");
    await $("button=Save server").click();
    await $(
      "[role='alert']=the server id must have 1 to 20 digits",
    ).waitForExist();

    await guild.setValue("123456789012345678");
    await $("button=Save server").click();
    await $("[role='alert']=The development server was saved.").waitForExist();
    await expect($("button=Remove")).toBeEnabled();
    expect(await browser.execute(() => window.__e2e.devGuild)).toBe(
      "123456789012345678",
    );

    await $("button=Remove").click();
    await $(
      "[role='alert']=The development server was removed.",
    ).waitForExist();
    await expect(guild).toHaveValue("");
    expect(await browser.execute(() => window.__e2e.devGuild)).toBeNull();
  });

  it("closes with Escape, gives the focus back, and opens empty again", async () => {
    await browser.keys(["Escape"]);
    await expect($("dialog")).not.toExist();
    expect(await focusedText()).toBe("Bot settings");

    await $("button=Bot settings").click();
    await expect($("#bot-token")).toHaveValue("");
    // The state is read again from Rust, not remembered by the page.
    await $("[role='status']=A token is set").waitForExist();
    await $("button=Close").click();
    await expect($("dialog")).not.toExist();

    expect(await everythingShown()).not.toContain(MARKER);
    expect(await violations()).toEqual([]);
  });
});

describe("exporting", () => {
  before(async () => {
    await start();
    await openPing();
  });

  it("offers a name, refuses a bad one with Rust's message and exports a good one", async () => {
    await $("button=Export").click();
    const name = $("#bot-name");
    await expect($("dialog[open]")).toBeDisplayed();
    await expect(name).toHaveValue("my-bot");

    await name.setValue(".hidden");
    await $("button=Choose folder and export").click();
    await $("[role='alert']=the name starts with a dot").waitForExist();
    await expect($("dialog[open]")).toBeDisplayed();
    expect(await browser.execute(() => window.__e2e.exported)).toEqual([]);

    await name.setValue("ping-bot");
    await browser.keys(["Enter"]);
    await expect($("dialog")).not.toExist();
    await browser.waitUntil(async () => (await notice()) !== null);
    const text = await notice();
    expect(text).toContain("/tmp/e2e/ping-bot");
    expect(text).toContain(".env.example");
    expect(await browser.execute(() => window.__e2e.exported)).toEqual([
      "ping-bot",
    ]);
    // The export does not start the bot.
    expect((await backend()).calls.some((c) => c.cmd === "start_bot")).toBe(
      false,
    );
    await expect($("button=Run")).toBeEnabled();
  });

  it("changes nothing when the person cancels the folder dialog", async () => {
    await $("button=Dismiss").click();
    await browser.execute(() => {
      window.__e2e.exportCancel = true;
    });
    await $("button=Export").click();
    await $("button=Choose folder and export").click();
    await browser.waitUntil(
      async () =>
        (await backend()).calls.filter((c) => c.cmd === "export_bot").length >=
        2,
    );
    await expect($("dialog[open]")).toBeDisplayed();
    expect(await notice()).toBeNull();
    // Escape closes it and the focus goes back to the button.
    await browser.keys(["Escape"]);
    await expect($("dialog")).not.toExist();
    expect(await focusedText()).toBe("Export");
  });

  it("explains a project with errors and writes nothing", async () => {
    await select("reply");
    await (await field("Message")).click();
    await browser.keys(["Control", "a"]);
    await browser.keys(["Backspace"]);
    await waitForProblems("Errors: 1 · Warnings: 0");

    await $("button=Export").click();
    await $("button=Choose folder and export").click();
    await expect($("dialog")).not.toExist();
    await browser.waitUntil(async () => (await notice()) !== null);
    expect(await notice()).toBe(
      "The project has 1 errors; nothing was exported.",
    );
    expect(await browser.execute(() => window.__e2e.exported)).toEqual([
      "ping-bot",
    ]);
    expect(await violations()).toEqual([]);
  });
});
