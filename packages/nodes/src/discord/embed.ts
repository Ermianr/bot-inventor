import { joinStatements, type NodeDefinition } from "../definition.js"

/** Discord's own blurple, so an Embed dropped on the Canvas already has a bar. */
const DEFAULT_COLOUR = 0x5865f2

/**
 * Builds the rich block Discord draws under a message. It carries an Embed on
 * its Data output, and nothing else can read that: an Embed is a value of its
 * own and never text, so the Coercion table has no entry taking it anywhere.
 *
 * Its title and description are Slotted text fields, which is what lets an
 * Embed say `Who: @someone` without a Node whose only job is gluing two
 * strings together (ADR 0010).
 */
export const embed: NodeDefinition = {
  id: "discord.embed.build",
  labelKey: "nodes.discord.embed.build.label",
  descriptionKey: "nodes.discord.embed.build.description",
  isTrigger: false,
  ports: [
    { id: "in", kind: "execution", direction: "input", labelKey: "ports.in.label" },
    { id: "next", kind: "execution", direction: "output", labelKey: "ports.next.label" },
    {
      id: "embed",
      kind: "data",
      direction: "output",
      dataType: "embed",
      labelKey: "nodes.discord.embed.build.ports.embed.label"
    }
  ],
  fields: [
    {
      id: "title",
      labelKey: "nodes.discord.embed.build.fields.title.label",
      control: "slottedText",
      defaultValue: []
    },
    {
      id: "description",
      labelKey: "nodes.discord.embed.build.fields.description.label",
      control: "slottedText",
      defaultValue: []
    },
    {
      id: "colour",
      labelKey: "nodes.discord.embed.build.fields.colour.label",
      control: "colour",
      defaultValue: DEFAULT_COLOUR
    }
  ],
  generate(context) {
    const parts = [
      `title: ${context.slottedField("title")}`,
      `description: ${context.slottedField("description")}`,
      `colour: ${context.literal(context.field("colour"))}`
    ].join(", ")

    // The Runtime is what decides what Discord ends up seeing — an empty title
    // left out, a colour brought into range — so that every Embed is
    // normalised the same way, whichever Node built it.
    return joinStatements([
      context.trace({ kind: "node-entered" }),
      `const ${context.output("embed")} = ${context.runtime}.embed.build({ ${parts} })`,
      context.trace({ kind: "node-completed" }),
      context.continuation("next")
    ])
  }
}
