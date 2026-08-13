import { packageName as nodesPackageName } from "@bot-inventor/nodes"
import { packageName as schemaPackageName } from "@bot-inventor/schema"
import { describe, expect, it } from "vitest"
import { packageName } from "./index"

describe("@bot-inventor/compiler", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@bot-inventor/compiler")
  })

  it("resolves its workspace dependencies", () => {
    expect(schemaPackageName).toBe("@bot-inventor/schema")
    expect(nodesPackageName).toBe("@bot-inventor/nodes")
  })
})
