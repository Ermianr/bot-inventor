import { packageName as nodesPackageName } from "@bot-inventor/nodes"
import { CURRENT_SCHEMA_VERSION } from "@bot-inventor/schema"
import { describe, expect, it } from "vitest"
import { packageName } from "./index"

describe("@bot-inventor/compiler", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@bot-inventor/compiler")
  })

  it("resolves its workspace dependencies", () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(nodesPackageName).toBe("@bot-inventor/nodes")
  })
})
