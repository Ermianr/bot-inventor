import { rm } from "node:fs/promises"
import path from "node:path"

import tailwind from "bun-plugin-tailwind"

/**
 * The production bundle, which is what `frontendDist` in `tauri.conf.json`
 * points at and what `tauri build` embeds.
 *
 * `--splitting` is on and the Routes split themselves: without
 * `@tanstack/router-plugin` there is no automatic code splitting, so each Route
 * that is worth splitting declares it with `createLazyFileRoute` and this
 * produces the chunk. See `src/routes` for which ones do.
 */
const root = import.meta.dirname
const outdir = path.join(root, "dist")

await rm(outdir, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [path.join(root, "index.html")],
  outdir,
  target: "browser",
  splitting: true,
  minify: true,
  sourcemap: "linked",
  // The compiler's own defaults are `infer` and `none`, which is what
  // `reactCompilerOptions` in `react-compiler.ts` asks for. This flag takes no
  // options, so if that file ever wants something other than the defaults, this
  // stops being equivalent and the divergence has to be handled here.
  reactCompiler: true,
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") }
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const bytes = result.outputs.reduce((total, output) => total + output.size, 0)
console.log(`bundled ${result.outputs.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`)
