import { expect, test } from "@playwright/test"
import { CanvasPage } from "./pages/canvas-page"
import { InspectorPage } from "./pages/inspector-page"

/**
 * The preview of an Embed: what the message will look like, before the bot has
 * ever run.
 *
 * What the renderer decides is settled in `discord-markup.test.ts` as a table
 * of cases. What is proved here is the part only a browser can answer — that
 * the preview is in the Inspector, that it draws each part where Discord draws
 * it and flattens the parts Discord flattens, and that it never invents a value
 * it has no way of knowing.
 */
test.describe("the preview of an Embed", () => {
  /** A corner of the Canvas the demonstration Flow's Nodes are nowhere near. */
  const empty = { x: 520, y: 80 }

  /** The first Node this Flow is given, the other two being named by hand. */
  const embed = "node-1"

  let canvas: CanvasPage
  let inspector: InspectorPage

  test.beforeEach(async ({ page }) => {
    canvas = new CanvasPage(page)
    inspector = new InspectorPage(page)
    await canvas.open()

    await canvas.rightClickPane(empty)
    await canvas.addNode().click()
    await canvas.nodeChoice("discord.embed.build").click()
    await canvas.node(embed).click()
    await expect(inspector.panel(embed)).toBeVisible()
  })

  test("is drawn in the Inspector, while the Canvas keeps only the bar and the title", async () => {
    await canvas.fieldBox(embed, "title", 0).fill("Welcome")

    await expect(inspector.panel(embed).getByTestId("embed-preview")).toBeVisible()
    await expect(inspector.summary(embed)).toContainText("Welcome")
    await expect(inspector.summaryColour(embed)).toBeVisible()
    // The Node on the Canvas is the summary and nothing else: its thirteen
    // fields are what the Inspector exists for.
    await expect(canvas.node(embed).getByTestId(`field-box-${embed}-title-0`)).toHaveCount(0)
  })

  test("says there is nothing to show until the Embed holds something", async () => {
    await expect(inspector.empty()).toBeVisible()
    await expect(inspector.preview()).toHaveCount(0)

    await canvas.fieldBox(embed, "title", 0).fill("Welcome")

    await expect(inspector.empty()).toHaveCount(0)
    await expect(inspector.part("title")).toHaveText("Welcome")
  })

  test("renders Discord's formatting in the description, where Discord renders it", async () => {
    await canvas
      .fieldBox(embed, "description", 0)
      .fill("**bold** *italic* __underline__ ~~gone~~ `code`")

    const description = inspector.part("description")
    await expect(description.locator("strong")).toHaveText("bold")
    await expect(description.locator("em")).toHaveText("italic")
    await expect(description.locator("u")).toHaveText("underline")
    await expect(description.locator("s")).toHaveText("gone")
    await expect(description.locator("code")).toHaveText("code")
  })

  test("renders the blocks a description can be built out of", async () => {
    await canvas
      .fieldBox(embed, "description", 0)
      .fill("# Heading\n> quoted\n- first\n- second\n[a link](https://example.com)")

    const description = inspector.part("description")
    await expect(description.locator("blockquote")).toContainText("quoted")
    await expect(description.locator("li")).toHaveCount(2)
    await expect(description.locator("li").first()).toHaveText("first")
    await expect(description).toContainText("Heading")
    await expect(description.getByTitle("https://example.com")).toHaveText("a link")
  })

  test("leaves the title flat, the way Discord leaves it", async () => {
    await canvas.fieldBox(embed, "title", 0).fill("**not bold**")

    // The markers are still there to read, because that is what a reader of the
    // message will see: Discord renders nothing in a title.
    await expect(inspector.part("title")).toHaveText("**not bold**")
    await expect(inspector.part("title").locator("strong")).toHaveCount(0)
  })

  test("leaves the footer flat as well", async () => {
    await canvas.fieldBox(embed, "footerText", 0).fill("**not bold**")

    await expect(inspector.part("footer")).toContainText("**not bold**")
    await expect(inspector.part("footer").locator("strong")).toHaveCount(0)
  })

  test("draws what it cannot resolve as a neutral pill of the right shape", async () => {
    await canvas.fieldBox(embed, "description", 0).fill("<@1> said <:wave:2> at <t:1700000000:F>")

    await expect(inspector.pills("mention")).toHaveCount(1)
    await expect(inspector.pills("emoji")).toHaveCount(1)
    await expect(inspector.pills("timestamp")).toHaveCount(1)
    // No name, no picture and no hour: the editor is not connected to Discord,
    // and a pill that guessed would be the preview inventing the message.
    await expect(inspector.pills("mention")).not.toContainText("1")
  })

  test("keeps a spoiler hidden, the way its readers will find it", async () => {
    await canvas.fieldBox(embed, "description", 0).fill("the answer is ||42||")

    await expect(inspector.spoilers()).toHaveText("42")
    await expect(inspector.spoilers()).toHaveCSS("color", "rgba(0, 0, 0, 0)")
  })

  test("lays a pair marked inline beside its neighbours, and the rest across the width", async () => {
    await inspector.addEmbedField(embed, "embedFields").click()
    await inspector.addEmbedField(embed, "embedFields").click()

    await canvas.fieldBox(embed, "embedFields.0.name", 0).fill("Left")
    await canvas.fieldBox(embed, "embedFields.0.value", 0).fill("one")
    await canvas.fieldBox(embed, "embedFields.1.name", 0).fill("Wide")
    await canvas.fieldBox(embed, "embedFields.1.value", 0).fill("two")
    await inspector.inlineEmbedField(embed, "embedFields", 0).click()

    await expect(inspector.embedFields()).toHaveCount(2)
    await expect(inspector.embedFields().first()).toHaveAttribute("data-inline", "true")
    await expect(inspector.embedFields().last()).toHaveAttribute("data-inline", "false")
    // A pair's name is flat too, and its value is not.
    await expect(inspector.embedFields().first()).toContainText("Left")
  })

  test("draws a Slot as its own pill rather than inventing a value for it", async () => {
    await canvas.dropWireOnField(
      canvas.port("node-trigger", "user"),
      canvas.fieldBox(embed, "title", 0)
    )

    await expect(inspector.slots()).toHaveCount(1)
    await expect(inspector.slots()).toContainText("Who used it")
  })
})
