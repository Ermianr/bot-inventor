import { describe, expect, test } from "bun:test"

/**
 * The ceiling is the gzipped size measured on `main` when this test landed
 * (64.6 KB), rounded up so that ordinary minifier drift does not fail the
 * build. It is not a fine-grained performance budget: it is a trap for the two
 * regressions the Zod Mini migration identified by name, a namespace `zod`
 * import and a `locales` namespace import, each of which costs tens of
 * kilobytes. The migration tickets that follow lower this number as they land.
 */
const CEILING_IN_BYTES = 68 * 1024

const formatKilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

describe("the bundled schema entry point", () => {
  test("stays under the gzipped size ceiling", async () => {
    const build = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`],
      target: "browser",
      minify: true
    })

    expect(build.success).toBe(true)

    const chunks = await Promise.all(build.outputs.map(output => output.text()))
    const gzippedSize = Bun.gzipSync(Buffer.from(chunks.join("\n"))).byteLength

    expect(
      gzippedSize,
      `the bundled schema entry point is ${formatKilobytes(gzippedSize)} gzipped, over the ${formatKilobytes(CEILING_IN_BYTES)} ceiling`
    ).toBeLessThanOrEqual(CEILING_IN_BYTES)
  })
})
