import { $, browser, expect } from "@wdio/globals";
import {
  addNode,
  createProject,
  drag,
  field,
  node,
  press,
  select,
  start,
  status,
  waitForAliases,
} from "../support/editor";

const UNDO = ["Control", "z"];
const REDO = ["Control", "Shift", "z"];

describe("undo and redo", () => {
  beforeEach(async () => {
    await start();
    await createProject();
  });

  it("undoes a whole phrase typed in a field in one step, also inside the field", async () => {
    const reply = await addNode("Reply");
    await select(reply);
    const message = await field("Message");
    await message.click();
    await browser.keys([..."Hello there"]);
    await expect(message).toHaveValue("Hello there");

    await press(...UNDO);
    await expect(message).toHaveValue("");

    await press(...REDO);
    await expect(message).toHaveValue("Hello there");
  });

  it("goes back to Saved when an undo reaches the saved project", async () => {
    expect(await status()).toBe("Saved");
    await addNode("Reply");
    expect(await status()).toBe("Unsaved changes");
    await $("button=Undo").click();
    expect(await status()).toBe("Saved");
    await waitForAliases([]);
    await $("button=Redo").click();
    expect(await status()).toBe("Unsaved changes");
    await waitForAliases(["reply"]);
  });

  it("undoes a drag in one step", async () => {
    const reply = await addNode("Reply");
    const before = await node(reply).getLocation();
    await drag(reply, 200, 80);
    const moved = await node(reply).getLocation();
    expect(moved.x).not.toBe(before.x);

    await press(...UNDO);
    await browser.waitUntil(
      async () => (await node(reply).getLocation()).x === before.x,
    );
    expect((await node(reply).getLocation()).y).toBe(before.y);
  });

  it("undoes the creation of a flow and shows the flow that is left", async () => {
    await $("button=New flow").click();
    await expect($("nav[aria-label='Flows'] button.current")).toHaveText(
      "flow",
    );
    await press(...UNDO);
    await expect($("nav[aria-label='Flows'] button.current")).toHaveText(
      "main",
    );
    await expect($("nav[aria-label='Flows']").$("button=flow")).not.toExist();
    await press(...REDO);
    await expect($("nav[aria-label='Flows'] button.current")).toHaveText(
      "flow",
    );
  });
});
