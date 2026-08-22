import { describe, expect, test } from "bun:test"

import { type FieldValue, fieldValueSchema } from "./project.js"
import type { Validator } from "./validator.js"

describe("Validator", () => {
  test("annotates the recursive field-value schema without naming the library", () => {
    const fieldValue: Validator<FieldValue> = fieldValueSchema
    const nested = { a: [1, "two", { three: null }] }

    expect(fieldValue.parse(nested)).toEqual(nested)
    expect(fieldValue.safeParse(() => {}).success).toBe(false)
  })
})
