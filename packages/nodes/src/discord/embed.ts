import {
  type FieldDefinition,
  type GenerationContext,
  joinStatements,
  type NodeDefinition
} from "../definition.js"
import { writtenEmbedFields } from "../embed-fields.js"
import { isSlotted } from "../slots.js"

/** Discord's own blurple, so an Embed dropped on the Canvas already has a bar. */
const DEFAULT_COLOUR = 0x5865f2

/**
 * What the user types into an Embed. It is declared out here so that the code
 * generation below can read which parts are Slotted rather than repeating the
 * list: a part added here is a part that is sent.
 */
const FIELDS: readonly FieldDefinition[] = [
  {
    id: "title",
    labelKey: "nodes.discord.embed.build.fields.title.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "url",
    labelKey: "nodes.discord.embed.build.fields.url.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "description",
    labelKey: "nodes.discord.embed.build.fields.description.label",
    control: "slottedParagraph",
    defaultValue: []
  },
  {
    id: "embedFields",
    labelKey: "nodes.discord.embed.build.fields.embedFields.label",
    control: "embedFields",
    defaultValue: []
  },
  {
    id: "colour",
    labelKey: "nodes.discord.embed.build.fields.colour.label",
    control: "colour",
    defaultValue: DEFAULT_COLOUR
  },
  {
    id: "authorName",
    labelKey: "nodes.discord.embed.build.fields.authorName.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "authorUrl",
    labelKey: "nodes.discord.embed.build.fields.authorUrl.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "authorIcon",
    labelKey: "nodes.discord.embed.build.fields.authorIcon.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "image",
    labelKey: "nodes.discord.embed.build.fields.image.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "thumbnail",
    labelKey: "nodes.discord.embed.build.fields.thumbnail.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "footerText",
    labelKey: "nodes.discord.embed.build.fields.footerText.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "footerIcon",
    labelKey: "nodes.discord.embed.build.fields.footerIcon.label",
    control: "slottedText",
    defaultValue: []
  },
  {
    id: "timestamp",
    labelKey: "nodes.discord.embed.build.fields.timestamp.label",
    control: "switch",
    defaultValue: false
  }
]

/**
 * Builds the rich block Discord draws under a message. It carries an Embed on
 * its Data output, and nothing else can read that: an Embed is a value of its
 * own and never text, so the Coercion table has no entry taking it anywhere.
 *
 * Every text part of it is a Slotted field, which is what lets an Embed say
 * `Who: @someone` without a Node whose only job is gluing two strings together
 * (ADR 0010). Its description is edited over several lines, because that is the
 * one part of an Embed people write paragraphs in, and its Embed Fields are
 * edited as a list, because how many of them there are is the user's to decide.
 *
 * The time it was sent is a switch rather than a date field: what people want
 * is the Embed stamped with when it went out, and the Runtime is what reads
 * the clock.
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
  fields: FIELDS,
  generate(context) {
    // Every text part of the Embed is a Slotted field and reads the same way,
    // and each one is handed over under the name the Runtime's builder knows
    // it by, which is the field's own id. Which fields those are is read off
    // the declaration above, so a part added there is a part that is sent.
    const parts = [
      ...FIELDS.filter(field => isSlotted(field.control)).map(
        field => `${field.id}: ${context.slottedField(field.id)}`
      ),
      `colour: ${context.literal(context.field("colour"))}`,
      `embedFields: [${embedFieldsCode(context)}]`,
      `timestamp: ${context.literal(context.field("timestamp"))}`
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

/**
 * The Embed Fields as the list the builder takes, in the order they were
 * written: that order is the layout the user laid out on the Canvas.
 *
 * A name and a value are Slotted text like the rest of the Embed, so each of
 * them is emitted as its own expression rather than as a string. Every pair the
 * Project holds is emitted, the ones past Discord's limit included: the editor
 * is what stops the user at twenty-five, and the Runtime is what decides what
 * Discord ends up seeing.
 */
function embedFieldsCode(context: GenerationContext): string {
  return writtenEmbedFields(context.field("embedFields"))
    .map((embedField, index) => {
      // A pair is refused for its name or its value not reading as text, the
      // same way a field of its own is: an Embed Field quietly emptied is a row
      // Discord draws nothing for and nothing saying why (ADR 0008).
      const name = context.slottedText(embedField.name, `the name of pair ${index + 1}`)
      const value = context.slottedText(embedField.value, `the value of pair ${index + 1}`)
      return `{ name: ${name}, value: ${value}, inline: ${context.literal(embedField.inline)} }`
    })
    .join(", ")
}
