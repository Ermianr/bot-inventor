import { $, browser, expect } from "@wdio/globals";
import type { Project } from "../../src/lib/bindings";
import {
  aliases,
  answerOpen,
  backend,
  field,
  node,
  panel,
  panelMessages,
  press,
  select,
  start,
  waitForAliases,
} from "../support/editor";

/** The expression the builder writes, as the panel shows it. */
function shown(): ReturnType<typeof $> {
  return panel().$("code[aria-label='Expression']");
}

async function expressionIs(text: string): Promise<void> {
  await browser.waitUntil(async () => (await shown().getText()) === text, {
    timeoutMsg: `the expression never became ${text}; it is ${await shown().getText()}`,
  });
}

/** Chooses an option of a menu of the panel by its text. */
async function choose(label: string, option: string): Promise<void> {
  const menu = await field(label);
  await menu.selectByVisibleText(option);
}

/** The editable text of the CodeMirror editor of the panel, which lives in a shadow root. */
function editorContent(): ReturnType<typeof $> {
  return panel().$(".code").shadow$(".cm-content");
}

/** Replaces the text of the CodeMirror editor of the panel. */
async function typeInEditor(text: string): Promise<void> {
  const editor = editorContent();
  await editor.waitForDisplayed();
  await editor.click();
  await browser.keys(["Control", "a"]);
  await browser.keys(text.split(""));
}

const bot: Project = {
  manifest: {
    format_version: 1,
    name: "Moderation",
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
          settings: { name: "ping", description: "Replies" },
          editor: { x: 0, y: 0 },
        },
        {
          id: "n2",
          alias: "reply",
          type: "discord.reply",
          type_version: 1,
          settings: { content: "Pong!" },
          editor: { x: 300, y: 0 },
        },
        {
          id: "n3",
          alias: "branch",
          type: "logic.branch",
          type_version: 1,
          settings: {},
          editor: { x: 600, y: 0 },
        },
      ],
      lines: [
        { from: { node: "n1", port: "next" }, to: "n2" },
        { from: { node: "n2", port: "next" }, to: "n3" },
      ],
    },
  },
};

describe("the condition builder", () => {
  before(async () => {
    await start();
    await answerOpen(bot);
    await $("button=Open project").click();
    await waitForAliases(["slash_command", "reply", "branch"]);
  });

  it("builds a condition from lists and shows the expression it writes", async () => {
    await select("branch");
    await panel().$("button=Add a test").click();
    // The first test compares the first name of the list with empty text.
    await expressionIs('event.command.name == ""');

    await (await field("Kind of value to compare with 1")).setValue("ping");
    await expressionIs('event.command.name == "ping"');

    await choose("Value 1", "steps.reply.message_id");
    await choose("Test 1", "is not equal to");
    await expressionIs('steps.reply.message_id != "ping"');

    await panel().$("button=Add a test").click();
    await choose("Combine the tests", "Any of these is true");
    await choose("Test 2", "is equal to");
    await expressionIs(
      'steps.reply.message_id != "ping" || event.command.name == ""',
    );

    // A test on text offers the tests of text, and a number the tests of numbers.
    await choose("Test 2", "starts with");
    await expressionIs(
      'steps.reply.message_id != "ping" || event.command.name.startsWith("")',
    );
    await panel().$("button=Remove test 2").click();
    await expressionIs('steps.reply.message_id != "ping"');
  });

  it("shows the same text in the advanced mode, and takes it back when the builder can read it", async () => {
    await panel().$("button=Advanced").click();
    await expect(editorContent()).toHaveText(
      'steps.reply.message_id != "ping"',
    );

    await typeInEditor('event.user.id == "42" && event.guild.id != "1"');
    await panel().$("button=Builder").click();
    await expressionIs('event.user.id == "42" && event.guild.id != "1"');
    expect((await panel().$$("[role='group'][aria-label^='Row']")).length).toBe(
      2,
    );

    // A shape the builder cannot show stays as text and says why.
    await panel().$("button=Advanced").click();
    await typeInEditor("size(event.member.roles) > 1");
    await panel().$("button=Builder").click();
    await expect(panel().$(".note")).toHaveText(
      "This expression has a shape the builder cannot show. Edit it as text.",
    );
    await expect(editorContent()).toHaveText("size(event.member.roles) > 1");
    await typeInEditor('steps.reply.message_id == "x"');
    await panel().$("button=Builder").click();
    await expressionIs('steps.reply.message_id == "x"');
  });

  it("completes the names of the node as they are typed", async () => {
    await panel().$("button=Advanced").click();
    await typeInEditor("steps.re");
    const option = panel().$(".code").shadow$(".cm-tooltip-autocomplete li");
    await option.waitForDisplayed();
    await expect(option).toHaveText(
      expect.stringContaining("steps.reply.message_id"),
    );
    await press("Escape");

    await typeInEditor('steps.reply.message_id == "x"');
    await panel().$("button=Builder").click();
    await expressionIs('steps.reply.message_id == "x"');
  });

  it("undoes what is typed in the editor with the history of the project", async () => {
    // Choosing another node closes the step that was being typed.
    await select("reply");
    await select("branch");
    await panel().$("button=Advanced").click();
    await expect(editorContent()).toHaveText('steps.reply.message_id == "x"');
    await typeInEditor('event.user.id == "9"');
    await expect(editorContent()).toHaveText('event.user.id == "9"');
    await press("Control", "z");
    await expect(editorContent()).toHaveText('steps.reply.message_id == "x"');
    await panel().$("button=Builder").click();
    await expressionIs('steps.reply.message_id == "x"');
  });

  it("renames a node together with the reads of it, in one step", async () => {
    await select("reply");
    const alias = await field("Alias");
    await alias.setValue("answer");
    await press("Enter");
    await waitForAliases(["slash_command", "answer", "branch"]);

    await select("branch");
    await expressionIs('steps.answer.message_id == "x"');

    await $("button=Undo").click();
    await waitForAliases(["slash_command", "reply", "branch"]);
    await select("branch");
    await expressionIs('steps.reply.message_id == "x"');
    await $("button=Redo").click();
    await waitForAliases(["slash_command", "answer", "branch"]);
    await select("branch");
    await expressionIs('steps.answer.message_id == "x"');
  });

  it("marks a read that points at nothing after its node is deleted", async () => {
    await select("answer");
    await press("Delete");
    await browser.waitUntil(async () => !(await aliases()).includes("answer"));

    await select("branch");
    const row = panel().$("[role='group'][aria-label='Row 1']");
    await expect(row).toHaveElementClass("missing");
    await expect(row.$(".problem")).toHaveText(
      "This test reads something that does not exist at this node.",
    );
    // The builder shows the name as missing and leaves it as it was.
    await expressionIs('steps.answer.message_id == "x"');
    await browser.waitUntil(async () =>
      (await panelMessages()).includes(
        "no node of this flow has the alias `answer`",
      ),
    );
    await expect(node("branch").$(".problems")).toExist();
  });

  it("ran under the production CSP without a violation", async () => {
    const { violations } = await backend();
    expect(violations).toEqual([]);
    await browser.saveScreenshot("./e2e/last-run.png");
  });
});
