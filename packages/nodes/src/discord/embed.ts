import {
  buildEmbed,
  checkEmbed,
  describeEmbedProblem,
  EMBED_LIMITS,
  type EmbedInput,
  type EmbedProblem
} from "@bot-inventor/runtime/embed"
import { type FieldValue, readSlottedText } from "@bot-inventor/schema"
import {
  type FieldDefinition,
  type GenerationContext,
  joinStatements,
  type NodeDefinition,
  type NodeFields,
  type NodeProblem
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
    defaultValue: [],
    limit: EMBED_LIMITS.title
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
    defaultValue: [],
    limit: EMBED_LIMITS.description
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
    defaultValue: [],
    limit: EMBED_LIMITS.authorName
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
    defaultValue: [],
    limit: EMBED_LIMITS.footerText
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
  problems: embedProblems,
  generate(context) {
    // What the editor already refused is refused here too, so that a Project
    // that arrived from a hand edit or an older build cannot be run or exported
    // into a bot Discord answers with a `400`.
    const [fault] = embedFaults(fieldsOf(context))
    if (fault !== undefined) {
      throw new Error(`the Embed Node cannot be sent: ${describeEmbedProblem(fault)}`)
    }

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

/**
 * What a Slot stands in for while the Embed is being looked at rather than run.
 *
 * One character, because that is the least the value that lands there can be:
 * what the Wire actually carries is only known when the bot runs, and the
 * Runtime is what checks it then. So an Embed whose title is nothing but a Slot
 * is not an empty Embed, and a field the editor already counts as full is full
 * here too — the count the user types against and this measurement are the same
 * arithmetic, so the Node never says a field is too long that the count says is
 * not.
 */
const SLOT_PLACEHOLDER = "\u2026"

/**
 * What is wrong with the Embed a Node is holding, as far as can be known
 * without running it.
 *
 * It builds the Embed the Node describes and hands it to the Runtime's one
 * checker, so the editor and the bot are reading the same rules. What it cannot
 * know is what a Wire will carry: the Runtime checks that again when the value
 * has actually arrived, and a value that turns out too long there leaves by the
 * Failure Port.
 */
export function embedProblems(fields: NodeFields): readonly NodeProblem[] {
  return embedFaults(fields).map(nodeProblem)
}

/** The same, in the Runtime's own words, for whoever has nothing to translate with. */
function embedFaults(fields: NodeFields): readonly EmbedProblem[] {
  return checkEmbed(buildEmbed(embedInputOf(fields)))
}

/** The Embed the Node describes, with a Slot standing in for what it will carry. */
function embedInputOf(fields: NodeFields): EmbedInput {
  const input: Record<string, unknown> = {
    colour: fields.colour,
    timestamp: fields.timestamp,
    embedFields: writtenEmbedFields(fields.embedFields).map(embedField => ({
      name: writtenText(embedField.name),
      value: writtenText(embedField.value),
      inline: embedField.inline
    }))
  }

  for (const field of FIELDS) {
    if (isSlotted(field.control)) input[field.id] = writtenText(fields[field.id])
  }

  return input
}

/** One Slotted field as the text it will read as, Slots included. */
function writtenText(value: FieldValue | undefined): string {
  return readSlottedText(value)
    .map(segment => (segment.kind === "literal" ? segment.text : SLOT_PLACEHOLDER))
    .join("")
}

/**
 * One of the Runtime's problems as the editor draws it: a message of its own
 * per part, because a sentence about a title and a sentence about the value of
 * a pair are not the same sentence in every language.
 */
function nodeProblem(problem: EmbedProblem): NodeProblem {
  switch (problem.kind) {
    case "empty":
      return { messageKey: "canvas.embed.problem.empty" }
    case "too-many-embed-fields":
      return {
        messageKey: "canvas.embed.problem.tooManyEmbedFields",
        values: { count: String(problem.count), limit: String(problem.limit) }
      }
    case "too-long":
      return {
        messageKey: `canvas.embed.problem.${problem.part}.tooLong`,
        values: {
          index: String(problem.index ?? ""),
          length: String(problem.length),
          limit: String(problem.limit)
        }
      }
  }
}

/** The Node's fields as `problems` reads them, defaults and all. */
function fieldsOf(context: GenerationContext): NodeFields {
  return Object.fromEntries(FIELDS.map(field => [field.id, context.field(field.id)]))
}
