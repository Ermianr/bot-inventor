import { describe, expect, it } from "vitest"
import { packageName } from "./index"

describe("@bot-inventor/schema", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@bot-inventor/schema")
  })
})
