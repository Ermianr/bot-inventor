import { packageName as schemaPackageName } from "@bot-inventor/schema"
import { describe, expect, it } from "vitest"
import { packageName } from "./index"

describe("@bot-inventor/nodes", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@bot-inventor/nodes")
  })

  it("resolves its workspace dependencies", () => {
    expect(schemaPackageName).toBe("@bot-inventor/schema")
  })
})
