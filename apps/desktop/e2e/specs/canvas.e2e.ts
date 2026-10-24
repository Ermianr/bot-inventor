import { $, expect } from "@wdio/globals";
import {
  addNode,
  connect,
  createProject,
  drag,
  dropOnNode,
  waitForAliases,
  waitForEdges,
  node,
  press,
  select,
  start,
} from "../support/editor";

describe("the canvas", () => {
  beforeEach(async () => {
    await start();
    await createProject();
  });

  it("refuses a line into the trigger", async () => {
    const command = await addNode("Slash command");
    const reply = await addNode("Reply");
    await drag(reply, 320, 160);
    // The trigger has no input to release the line on.
    await expect(node(command).$(".svelte-flow__handle.target")).not.toExist();
    await dropOnNode(reply, "next", command);
    await waitForEdges(0);
    await expect($(".app > header .status")).toHaveText("Unsaved changes");
  });

  it("refuses the same line twice", async () => {
    const command = await addNode("Slash command");
    const reply = await addNode("Reply");
    await drag(reply, 320, 160);
    await connect(command, "next", reply);
    await connect(command, "next", reply);
    await waitForEdges(1);
  });

  it("deletes a node together with its lines", async () => {
    const command = await addNode("Slash command");
    const reply = await addNode("Reply");
    await drag(reply, 320, 160);
    await connect(command, "next", reply);
    await waitForEdges(1);

    await select(reply);
    await press("Delete");
    await expect(node(reply)).not.toExist();
    await waitForAliases([command]);
    await waitForEdges(0);

    await $("button=Undo").click();
    await waitForAliases([command, reply]);
    await waitForEdges(1);
  });

  it("shows a hint when no node, or more than one, is selected", async () => {
    await $("aside[aria-label='Properties'] .hint").waitForExist();
    await expect($("aside[aria-label='Properties'] .hint")).toHaveText(
      "Select a node to edit it.",
    );
  });
});
