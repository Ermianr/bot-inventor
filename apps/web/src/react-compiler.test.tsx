import { afterEach, describe, expect, it } from "bun:test"

import { cleanup, render, screen } from "@testing-library/react"

import { AboutDialog } from "@/components/about-dialog"

import { settled } from "../testing/settled"

/**
 * That the React Compiler ran over the application.
 *
 * This is the hole #88 fell through: the compiler turned `translate` into a
 * hook whose memo cache size varied with its argument, the editor could not
 * draw, and lint, types and every unit test stayed green because none of them
 * loaded compiled output. #93 closed that by compiling the tests. Nothing then
 * held the compiling itself to anything — the pass is a plugin, registered in a
 * preload now, and a plugin that stops matching stops matching quietly, leaving
 * a green suite that is testing the source rather than the build.
 *
 * So this is one test for the whole application rather than one per file, and
 * it reaches a component the ordinary way: through `@/components`, the import
 * path every other test in `apps/web` uses. A local component defined in this
 * file would only prove that the pass matched this file.
 *
 * What it reads is the compiler's fingerprint. A component the compiler has
 * taken opens by calling `_c`, the memo-cache hook it imports from
 * `react/compiler-runtime`; uncompiled source has no such call. That is a
 * property of the function rather than of the runner, so this test means the
 * same thing whatever runs it.
 */

afterEach(cleanup)

describe("the React Compiler", () => {
  it("compiles the components the editor draws with", async () => {
    render(<AboutDialog open onOpenChange={() => {}} />)
    await settled()

    // The dialog drew, so this is the component the application renders and not
    // some module that merely parsed.
    expect(screen.getByTestId("about-name").textContent).toBe("Bot Inventor")
    expect(AboutDialog.toString()).toContain("_c(")
  })
})
