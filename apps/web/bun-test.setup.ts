import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { plugin } from "bun"

import { reactCompilerBunPlugin } from "./react-compiler.ts"

/**
 * What every unit test of the editor runs before it starts.
 *
 * `bun test` has no per-file environment and no plugin option, so the two things
 * `vitest.config.ts` used to declare — the DOM and the React Compiler pass —
 * are set up here instead, once, for the whole run. `bunfig.toml` points at this
 * file under `[test] preload`.
 */

/**
 * The DOM. It is registered globally rather than per file, which is why the 20
 * `@vitest-environment jsdom` pragmas are gone: there is one place a reader
 * looks for the DOM now, and it is this line.
 */
GlobalRegistrator.register({
  // happy-dom navigates for real where jsdom only recorded the attempt, and the
  // About dialog's repository link is a navigation. Left on, a unit test run
  // fetches github.com and everything that page pulls in.
  settings: {
    navigation: {
      disableMainFrameNavigation: true,
      disableChildFrameNavigation: true,
      disableChildPageNavigation: true
    }
  }
})

/**
 * The React Compiler, as a runtime plugin around the same pass and the same
 * scope the dev server mounts. `bun test` has no React Compiler of its own —
 * `bun build --react-compiler` lives in the bundler — so the tests reach it
 * through Babel or not at all, and not at all is what #93 exists to prevent.
 */
await plugin(reactCompilerBunPlugin)

/**
 * React only treats `act()` as `act()` when it is told it is being tested, and
 * this flag is what tells it. Without it, `act()` prints "The current testing
 * environment is not configured to support act(...)" and then leaves the work
 * the scope caused to whatever the scheduler gets round to, rather than
 * flushing it before it hands back. What that cost is written down in ADR 0014.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true
