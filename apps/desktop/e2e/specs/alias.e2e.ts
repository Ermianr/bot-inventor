import { $, browser, expect } from "@wdio/globals";
import {
  addNode,
  aliases,
  waitForAliases,
  createProject,
  field,
  press,
  select,
  start,
} from "../support/editor";

// The message under the alias field; the other fields of the panel can show problems of their own.
const MESSAGE = "aside[aria-label='Properties'] input[id^='alias-'] ~ .problem";

describe("renaming a node", () => {
  beforeEach(async () => {
    await start();
    await createProject();
  });

  it("refuses an alias that is not valid or that is taken, and changes nothing on the way", async () => {
    await addNode("Reply");
    const second = await addNode("Reply");
    expect(second).toBe("reply_2");
    await select(second);

    const alias = await field("Alias");
    await alias.setValue("Bad Name");
    await expect($(MESSAGE)).toHaveText(
      "Use lowercase letters, digits and _, not starting with a digit, up to 64.",
    );
    // Typing "reply" passes through "r", "re", "rep" and "repl", which are fine; none of them is
    // applied before the person confirms.
    await alias.setValue("reply");
    await expect($(MESSAGE)).toHaveText(
      "Another node of this flow has that alias.",
    );
    await waitForAliases(["reply", "reply_2"]);

    // Leaving the field with a name that is refused puts the alias back.
    await press("Tab");
    await expect(alias).toHaveValue("reply_2");
    await expect($(MESSAGE)).not.toExist();
    await waitForAliases(["reply", "reply_2"]);
  });

  it("renames the node when a valid alias is confirmed", async () => {
    await addNode("Reply");
    await select("reply");
    const alias = await field("Alias");
    await alias.setValue("answer");
    await expect($(MESSAGE)).not.toExist();
    // Still the old one until it is confirmed.
    await waitForAliases(["reply"]);

    await press("Enter");
    await browser.waitUntil(async () => (await aliases())[0] === "answer");
    await $("button=Undo").click();
    await browser.waitUntil(async () => (await aliases())[0] === "reply");
  });
});
