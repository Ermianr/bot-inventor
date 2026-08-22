import { promises as fsp } from "node:fs"
import path from "node:path"

import { Generator, getConfig } from "@tanstack/router-generator"

/**
 * The Route tree generator, as the separate process the Bun dev server needs.
 *
 * Under Vite this was `@tanstack/router-plugin`, which generated the tree from
 * inside the bundler. Bun has no such plugin — its esbuild entrypoint ships the
 * generator as an inert stub, which is what #115 found — so generation has to
 * run beside the dev server instead of within it.
 *
 * `tsr watch`, the generator's own CLI, cannot do that on Windows. It writes
 * the Route tree by atomic rename, the dev server holds an open handle on
 * `routeTree.gen.ts` because the file is in its module graph, and Windows
 * refuses to rename over a file that is being read. The CLI does not survive
 * it: the process exits, the dev server does not, and what is left is a Route
 * tree that has silently stopped updating.
 *
 * So the generator is driven through its own API here, with one method of its
 * injectable file system replaced. `rename` becomes copy-then-unlink, which
 * writes the destination in place rather than replacing the directory entry,
 * and Windows permits that against an open handle. Everything else is the
 * generator's own behaviour.
 */
const routeTreeFileSystem = {
  stat: async (filePath: string) => {
    const stat = await fsp.stat(filePath, { bigint: true })
    return {
      mtimeMs: stat.mtimeMs,
      mode: Number(stat.mode),
      uid: Number(stat.uid),
      gid: Number(stat.gid)
    }
  },
  /**
   * The one departure from the generator's defaults, and the reason this file
   * exists. Copying onto the destination keeps the handle the dev server holds
   * valid; renaming onto it fails with EPERM.
   */
  rename: async (oldPath: string, newPath: string) => {
    // Copying still loses to the dev server if it happens to have the file open
    // for reading at that instant, which shows up as a transient EBUSY while
    // both start at once. The window is a few milliseconds, so a couple of
    // retries close it; failing outright would leave the tree stale.
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.copyFile(oldPath, newPath)
        break
      } catch (problem) {
        const busy =
          problem instanceof Error &&
          "code" in problem &&
          (problem.code === "EBUSY" || problem.code === "EPERM")
        if (!busy || attempt === 4) throw problem
        await new Promise(resume => setTimeout(resume, 25 * (attempt + 1)))
      }
    }
    await fsp.unlink(oldPath)
  },
  writeFile: (filePath: string, content: string) => fsp.writeFile(filePath, content),
  readFile: async (filePath: string) => {
    try {
      const handle = await fsp.open(filePath, "r")
      const stat = await handle.stat({ bigint: true })
      const fileContent = (await handle.readFile()).toString()
      await handle.close()
      return { stat, fileContent }
    } catch (problem) {
      if (problem instanceof Error && "code" in problem && problem.code === "ENOENT") {
        return "file-not-existing" as const
      }
      throw problem
    }
  },
  chmod: (filePath: string, mode: number) => fsp.chmod(filePath, mode),
  chown: (filePath: string, uid: number, gid: number) => fsp.chown(filePath, uid, gid)
}

const root = path.resolve(import.meta.dirname, "..", "apps", "web")

const generator = new Generator({
  config: getConfig({}, root),
  root,
  fs: routeTreeFileSystem
})

/** Regenerates the tree, reporting a failure without taking the process down. */
const generate = async () => {
  try {
    await generator.run()
    return true
  } catch (problem) {
    console.error("[route-tree]", problem instanceof Error ? problem.message : problem)
    return false
  }
}

await generate()

if (process.argv.includes("--watch")) {
  const routesDirectory = path.join(root, "src", "routes")
  console.log(`[route-tree] watching ${path.relative(process.cwd(), routesDirectory)}`)

  // The generator reads the whole directory on every run, so overlapping file
  // events only need to collapse into one run rather than be tracked apart.
  let pending: ReturnType<typeof setTimeout> | undefined
  const watcher = fsp.watch(routesDirectory, { recursive: true })

  for await (const event of watcher) {
    void event
    clearTimeout(pending)
    pending = setTimeout(() => void generate(), 50)
  }
}
