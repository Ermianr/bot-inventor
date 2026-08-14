import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * The unit tests of the editor: the parts that are decisions rather than
 * pixels. Its own config, so that `vitest` never picks up the end-to-end specs
 * under `e2e/`, which only Playwright knows how to run.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    include: ["src/**/*.test.ts"]
  }
})
