import { catalogue } from "@bot-inventor/nodes"
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
          expect(translateDefinitionKey(key, locale)).not.toBe(key)
        }
      }
    })
  }
})
