import { $, expect } from "@wdio/globals";
import {
  addNode,
  badge,
  createProject,
  fill,
  panelMessages,
  problems,
  rowField,
  select,
  start,
  waitForBadge,
  waitForProblems,
  node,
  panel,
} from "../support/editor";

describe("diagnostics on the exact field", () => {
  beforeEach(async () => {
    await start();
    await createProject();
  });

  it("marks the field, the node and the toolbar, and clears them when it is fixed", async () => {
    const reply = await addNode("Reply");
    await select(reply);

    // The missing message, and a flow with no trigger (that one is counted but not on a node).
    await waitForProblems("Errors: 2 · Warnings: 0");
    await waitForBadge(reply, "1");
    await expect(node(reply).$(".card")).toHaveElementClass("failing");
    expect(await panelMessages()).toEqual(["`content` is required"]);

    await fill("Message", "Hello");
    await waitForBadge(reply, null);
    expect(await panelMessages()).toEqual([]);
    await waitForProblems("Errors: 1 · Warnings: 0");
  });

  it("marks the row of a list that has the problem, and not the whole list", async () => {
    const command = await addNode("Slash command");
    await select(command);
    await fill("Name", "ban");
    await fill("Description", "Bans somebody");
    await waitForProblems("No problems");

    await panel().$("button=Add").click();
    // The new row has no name and no description yet.
    await waitForBadge(command, "2");
    expect(await panelMessages()).toEqual([
      "`options[0].name` is required",
      "`options[0].description` is required",
    ]);

    await (await rowField(0, "Name")).setValue("user");
    await waitForBadge(command, "1");
    expect(await panelMessages()).toEqual([
      "`options[0].description` is required",
    ]);

    // The top-level fields never showed a problem.
    expect(await badge(command)).toBe("1");

    await panel().$("button=Remove").click();
    await waitForBadge(command, null);
    await waitForProblems("No problems");
    expect(await problems()).toBe("No problems");
    await expect($("fieldset")).not.toExist();
  });
});
