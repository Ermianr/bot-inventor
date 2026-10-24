import { $, browser, expect } from "@wdio/globals";
import type { Project } from "../../src/lib/bindings";
import {
  addNode,
  answerOpen,
  backend,
  createProject,
  notice,
  start,
  status,
  waitForAliases,
} from "../support/editor";

const project: Project = {
  manifest: {
    format_version: 1,
    name: "Moderation",
    platform: "discord",
    settings: {},
    variables: [],
  },
  flows: {
    ban: {
      nodes: [
        {
          id: "n1",
          alias: "ban_command",
          type: "discord.slash_command",
          type_version: 1,
          settings: { name: "ban", description: "Bans somebody" },
          editor: { x: 0, y: 0 },
        },
      ],
      lines: [],
    },
    kick: { nodes: [], lines: [] },
  },
};

describe("opening and saving", () => {
  beforeEach(start);

  it("opens a project with several flows and switches between them", async () => {
    await answerOpen(project);
    await $("button=Open project").click();
    await expect($(".app > header .project")).toHaveText("Moderation");
    await expect($("nav[aria-label='Flows'] button.current")).toHaveText("ban");
    await waitForAliases(["ban_command"]);

    await $("nav[aria-label='Flows']").$("button=kick").click();
    await waitForAliases([]);
    await $("nav[aria-label='Flows']").$("button=ban").click();
    await waitForAliases(["ban_command"]);
  });

  it("does nothing when the person cancels the dialog", async () => {
    await answerOpen(null);
    await $("button=Open project").click();
    await expect($("main.welcome")).toExist();
    expect(await notice()).toBeNull();
  });

  it("shows the message Rust gives when the project cannot be saved", async () => {
    await createProject();
    await addNode("Reply");
    await $("button=Save").click(); // the first save works
    await expect($(".app > header .status")).toHaveText("Saved");

    await addNode("Reply");
    await browser.execute(() => {
      window.__e2e.saveError = "cannot write the project: permission denied";
    });
    await $("button=Save").click();
    await browser.waitUntil(async () => (await notice()) !== null);
    expect(await notice()).toBe("cannot write the project: permission denied");
    expect(await status()).toBe("Unsaved changes");
  });

  it("does not open another project over unsaved changes", async () => {
    await createProject();
    await addNode("Reply");
    await answerOpen(project);
    await $("button=Open project").click();
    await browser.waitUntil(async () => (await notice()) !== null);
    expect(await notice()).toBe(
      "Save your changes before you open another project.",
    );
    await expect($(".app > header .project")).toHaveText("My bot");
    const { calls } = await backend();
    expect(calls.some((c) => c.cmd === "open_project")).toBe(false);
  });
});
