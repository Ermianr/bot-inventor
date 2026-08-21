import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import { reactCompiler } from "./react-compiler.ts"

/**
 * The unit tests of the editor: the parts that are decisions rather than
 * pixels. Its own config, so that `vitest` never picks up the end-to-end specs
 * under `e2e/`, which only Playwright knows how to run.
 *
 * The tests run through the React Compiler, the same pass and the same scope
 * the app ships with — that is what `reactCompiler()` is for, and why it is not
 * declared here. They did not, until #93. A compiled build can fail in ways
 * uncompiled source cannot: during #88 the compiler turned `translate` into a
 * hook whose memo cache size varied with its argument, which left the editor
 * unable to draw at all while `check`, `check-react-rules`, `check-types` and
 * every one of these tests stayed green. Only Playwright caught it, because
 * only Playwright loaded the real thing.
 *
 * It costs transform time on every run — around 3 seconds on a suite that took
 * 10 — and it is worth it, because otherwise the one gate that runs over every
 * component in the app, quickly, is blind by construction to what the compiler
 * does to them.
 */
export default defineConfig({
  plugins: [await reactCompiler()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"]
  }
})
