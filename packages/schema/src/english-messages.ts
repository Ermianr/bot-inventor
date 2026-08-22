import { config } from "zod/mini"
import en from "zod/v4/locales/en.js"

/**
 * Registers the English error map, so that an issue Zod words itself reads as
 * a sentence rather than as "Invalid input". `zod/mini` ships no locale, and
 * the map is global state, so this is the one place in the package that sets
 * it: every module that builds a schema imports this one for its side effect.
 *
 * The locale module is imported directly and never through the `locales`
 * namespace, which would pull in every language Zod ships and cost roughly
 * nine times the bundle.
 */
config(en())
