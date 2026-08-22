import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

/**
 * A guard on the patch `@tanstack/router-core` carries, which is what lets the
 * editor boot under the Bun dev server at all.
 *
 * `router.js` and `load-client.js` in that package import each other. Bun's
 * dev-server bundler resolves a cyclic import to a namespace object that is
 * still null while the modules initialise, so `router.js` reading
 * `replaceRouteChunk` at init time threw `Cannot read properties of null` and
 * nothing mounted. The patch defers that read to call time; see
 * `patches/@tanstack%2Frouter-core@*.patch`.
 *
 * This exists because the failure mode is silent, and it is silent twice over.
 * `patchedDependencies` is keyed by exact version, so any bump drops the patch
 * without warning. Worse, `@tanstack/react-router` pins its own copy of
 * `router-core`, and which copy wins has been seen to move with install order —
 * so the copy the editor loads is not necessarily the one a plain
 * `require.resolve` from here finds. Both times the only symptom is a blank
 * editor.
 *
 * So the resolution below deliberately walks out from `@tanstack/react-router`:
 * the copy that matters is the one the router itself imports, and checking any
 * other copy is how a green test comes to sit on top of a broken application.
 * The `overrides` entry in the root `package.json` is what keeps that copy
 * single.
 */
describe("the @tanstack/router-core patch", () => {
  const fromHere = createRequire(import.meta.url)
  const fromReactRouter = createRequire(fromHere.resolve("@tanstack/react-router"))
  const routerModule = path.join(
    path.dirname(fromReactRouter.resolve("@tanstack/router-core/package.json")),
    "dist",
    "esm",
    "router.js"
  )
  const source = readFileSync(routerModule, "utf8")

  it("is applied to the copy @tanstack/react-router loads", () => {
    expect(source).toContain("RouterCore.prototype._replaceRouteChunk = function")
  })

  it("leaves no eager read of the cyclic import behind", () => {
    // The unpatched line. If a version bump or a resolution shift brings it
    // back, the dev server stops mounting the editor and this is the cheapest
    // place to find that out.
    expect(source).not.toMatch(/_replaceRouteChunk\s*=\s*replaceRouteChunk\s*;/)
  })
})
