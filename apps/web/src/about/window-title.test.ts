import { describe, expect, it } from "vitest"

import { windowTitle } from "@/about/window-title"

describe("windowTitle", () => {
  it("puts the open Project in front of the application", () => {
    expect(windowTitle("Welcome bot")).toBe("Welcome bot — Bot Inventor")
  })

  it("is the application alone when no Project is open", () => {
    expect(windowTitle()).toBe("Bot Inventor")
  })

  it("is the application alone when the Project has no name worth showing", () => {
    expect(windowTitle("   ")).toBe("Bot Inventor")
  })
})
