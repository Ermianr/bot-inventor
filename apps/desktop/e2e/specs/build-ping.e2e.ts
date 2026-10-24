import { $, browser, expect } from "@wdio/globals";
import {
  addNode,
  backend,
  connect,
  createProject,
  drag,
  waitForEdges,
  fill,
  select,
  start,
  waitForProblems,
} from "../support/editor";

describe("building Ping from scratch", () => {
  before(start);

  it("makes the bot and saves it", async () => {
    await createProject();
    await expect($(".app > header .status")).toHaveText("Saved");

    const command = await addNode("Slash command");
    const reply = await addNode("Reply");
    expect([command, reply]).toEqual(["slash_command", "reply"]);
    await drag(reply, 320, 120);

    await select(command);
    await fill("Name", "ping");
    await fill("Description", "Replies with pong");
    await select(reply);
    await fill("Message", "Pong!");

    // Nothing leads to the reply yet.
    await waitForProblems("Errors: 1 · Warnings: 0");

    await connect(command, "next", reply);
    await waitForEdges(1);
    await waitForProblems("No problems");
    await expect($(".app > header .status")).toHaveText("Unsaved changes");

    await $("button=Save").click();
    await expect($(".app > header .status")).toHaveText("Saved");

    const { saved, violations } = await backend();
    expect(saved).toHaveLength(1);
    const flow = saved[0]?.flows.main;
    expect(flow?.nodes.map((n) => [n.type, n.alias, n.settings])).toEqual([
      [
        "discord.slash_command",
        "slash_command",
        { name: "ping", description: "Replies with pong" },
      ],
      ["discord.reply", "reply", { content: "Pong!" }],
    ]);
    expect(flow?.lines).toHaveLength(1);
    expect(flow?.lines[0]?.from.port).toBe("next");
    // The production CSP did not stop anything the canvas needs.
    expect(violations).toEqual([]);
    await browser.saveScreenshot("./e2e/last-run.png");
  });
});
