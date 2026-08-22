import { describe, expect, it } from "bun:test"

/**
 * The ceiling is the gzipped size measured on `main` when this test landed
 * (64.6 KB), with just enough room above it that ordinary minifier drift does
 * not fail the build. It is not a fine-grained performance budget: it is a trap
 * for the two regressions issue #125 identified by name, a namespace `zod`
 * import and a `locales` namespace import, each of which costs tens of
 * kilobytes. The migration tickets that follow lower this number as they land,
 * and #125 carries the measurement table behind it.
 */
const CEILING_IN_BYTES = 66 * 1024

const formatKilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

describe("the bundled schema entry point", () => {
  /**
   * The source entry point is measured rather than the built one the package
   * `exports`, so that the test does not wait on a build to run. They are the
   * same module graph.
   */
  it("stays under the gzipped size ceiling", async () => {
    const build = await Bun.build({
      entrypoints: [`${import.meta.dir}/index.ts`],
      target: "browser",
      minify: true
    })

    expect(build.success, build.logs.join("\n")).toBe(true)

    const chunks = await Promise.all(build.outputs.map(output => output.text()))
    const gzippedSize = Bun.gzipSync(Buffer.from(chunks.join("\n"))).byteLength

    console.log(
      `the bundled schema entry point is ${formatKilobytes(gzippedSize)} gzipped, against a ${formatKilobytes(CEILING_IN_BYTES)} ceiling`
    )

    expect(
      gzippedSize,
      `the bundled schema entry point is ${formatKilobytes(gzippedSize)} gzipped, over the ${formatKilobytes(CEILING_IN_BYTES)} ceiling`
    ).toBeLessThanOrEqual(CEILING_IN_BYTES)
  })
})
