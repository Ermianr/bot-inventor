import {
  addableNodes,
  catalogue,
  defaultFieldValue,
  embedProblems,
  type NodeFields,
  portsOf
} from "@bot-inventor/nodes"
import { EMBED_LIMITS } from "@bot-inventor/runtime/embed"
import { literalText } from "@bot-inventor/schema"
import { helloProject, requireFirst } from "@bot-inventor/schema/fixtures"
import { describe, expect, it } from "vitest"

import { LOCALES, translateDefinitionKey } from "@/i18n/messages"

/**
 * The text the catalogue asks for, in every language the application ships.
 *
 * A Node is searched for by the words the editor shows it under, so a Node
 * missing its Spanish label is not merely untranslated: it is a Node a Spanish
 * user cannot find at all, because what they would have to type instead is the
 * catalogue id they have never been shown.
 */
describe("the words a Node is named by", () => {
  for (const locale of LOCALES) {
    it(`names and describes every Node of the catalogue in ${locale}`, () => {
      for (const definition of catalogue.values()) {
        for (const key of [definition.labelKey, definition.descriptionKey]) {
          // A key that resolves to itself is a key nobody translated: that is
          // what `translateDefinitionKey` shows when it has nothing to show.
          expect(translateDefinitionKey(key, {}, locale)).not.toBe(key)
        }
      }
    })
  }
})

/**
 * The words a refused Node is listed with. A reason nobody translated reads as
 * a catalogue key next to a greyed Node, which tells the user nothing about why
 * they cannot pick it.
 */
describe("the reason a Node cannot be added", () => {
  for (const locale of LOCALES) {
    it(`explains every refusal in ${locale}`, () => {
      const flow = requireFirst(helloProject().flows, "Flow")
      const refused = addableNodes(flow, catalogue).filter(choice => !choice.addable)

      expect(refused.length).toBeGreaterThan(0)
      for (const choice of refused) {
        expect(translateDefinitionKey(choice.refusalKey ?? "", {}, locale)).not.toBe(
          choice.refusalKey
        )
      }
    })
  }
})

/**
 * The words a Node's own parts are named by: the fields it is typed into and
 * the Ports wires are drawn to. An Embed alone carries thirteen fields, and a
 * field showing its catalogue key is a field a Spanish user cannot fill in,
 * because nothing on it says what it is for.
 */
describe("the words a Node's parts are named by", () => {
  for (const locale of LOCALES) {
    it(`names every field and every Port of the catalogue in ${locale}`, () => {
      for (const definition of catalogue.values()) {
        const fields = Object.fromEntries(
          definition.fields.map(field => [field.id, defaultFieldValue(field)])
        )

        for (const field of definition.fields) {
          expect(translateDefinitionKey(field.labelKey, {}, locale)).not.toBe(field.labelKey)
        }

        for (const port of portsOf(definition, fields)) {
          // A Port the user named themselves — a slash command parameter —
          // carries their own words and has nothing to translate.
          if (port.label !== undefined) continue
          expect(translateDefinitionKey(port.labelKey, {}, locale)).not.toBe(port.labelKey)
        }
      }
    })
  }
})

/**
 * The sentences an Embed too big for Discord is refused with. Their keys are
 * built from the part that overflowed rather than written out, so a part nobody
 * translated is invisible until the user fills that part in.
 */
describe("the reason an Embed cannot be sent", () => {
  const long = (length: number) => literalText("a".repeat(length))

  const overfullFields: NodeFields = {
    title: long(EMBED_LIMITS.title + 1),
    description: long(EMBED_LIMITS.description + 1),
    authorName: long(EMBED_LIMITS.authorName + 1),
    footerText: long(EMBED_LIMITS.footerText + 1),
    embedFields: [
      {
        name: long(EMBED_LIMITS.embedFieldName + 1),
        value: long(EMBED_LIMITS.embedFieldValue + 1),
        inline: false
      },
      ...Array.from({ length: EMBED_LIMITS.embedFields }, () => ({
        name: literalText("a"),
        value: literalText("a"),
        inline: false
      }))
    ]
  }

  const reported = [...embedProblems({}), ...embedProblems(overfullFields)].map(
    problem => problem.messageKey
  )

  // The keys are listed rather than derived, so that a part added to an Embed
  // without a sentence of its own fails here instead of reaching the user.
  const expected = [
    "canvas.embed.problem.empty",
    "canvas.embed.problem.tooManyEmbedFields",
    "canvas.embed.problem.title.tooLong",
    "canvas.embed.problem.description.tooLong",
    "canvas.embed.problem.authorName.tooLong",
    "canvas.embed.problem.footerText.tooLong",
    "canvas.embed.problem.embedFieldName.tooLong",
    "canvas.embed.problem.embedFieldValue.tooLong",
    "canvas.embed.problem.total.tooLong"
  ]

  it("reports every way an Embed can be wrong", () => {
    expect([...new Set(reported)].toSorted()).toEqual(expected.toSorted())
  })

  for (const locale of LOCALES) {
    it(`says every one of them in ${locale}`, () => {
      for (const key of reported) {
        expect(translateDefinitionKey(key, {}, locale)).not.toBe(key)
      }
    })
  }
})
