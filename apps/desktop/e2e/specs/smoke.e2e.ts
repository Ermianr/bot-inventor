import { browser, expect, $ } from "@wdio/globals";

describe("the editor on a fake backend", () => {
  it("starts and shows the welcome page", async () => {
    await browser.url("/e2e/index.html");
    await expect($("h1")).toHaveText("Bot Inventor");
    await expect($("main.welcome h2")).toHaveText("Build a bot without code");
  });
});
