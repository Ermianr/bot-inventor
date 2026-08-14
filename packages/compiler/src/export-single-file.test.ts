import { type ChildProcess, spawn } from "node:child_process"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { helloProject } from "@bot-inventor/schema/fixtures"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ExportError, exportSingleFile, SINGLE_FILE_NAME } from "./export-single-file.js"
import { type FakeDiscordServer, startFakeDiscordServer } from "./fake-discord-server.js"

/**
 * The second test seam: an Export written to disk and run by the real Node.js
 * binary against a fake Discord.
 *
 * These are the only tests that can catch a bad external, an unresolvable
 * import or a bundle that is malformed — the in-process seam never loads the
 * artifact, so it structurally cannot see any of it. They are also slow: one
 * bundle and one child process each. Keep them few.
 *
 * An Export bundles the Runtime as it is published, so these run against
 * `@bot-inventor/runtime`'s build rather than its sources: run them through
 * Turborepo, which builds it first, and not by reaching for Vitest directly.
 */

const TOKEN = "not-a-real-token.aaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb"

/** Bundling discord.js takes seconds, and starting a child process takes more. */
const SLOW = 120_000

let directory: string
let bundle: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bot-inventor-export-"))
  const exported = await exportSingleFile(helloProject(), { outputDirectory: directory })
  bundle = await readFile(exported.path, "utf8")
}, SLOW)

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("the Single File an Export writes", () => {
  it("is one file, with no node_modules beside it", async () => {
    expect(await readdir(directory)).toEqual([SINGLE_FILE_NAME])
  })

  it("reads the token from the environment rather than carrying one", () => {
    // Exporting takes no token to begin with, so there is none to leak: what
    // this pins down is that the file asks the environment for it, which is
    // what makes it safe to put on GitHub.
    expect(bundle).toContain("process.env.DISCORD_TOKEN")
    expect(bundle).not.toContain(TOKEN)
  })

  it("carries no Tracing instrumentation", () => {
    expect(bundle).not.toContain("node-entered")
    expect(bundle).not.toContain("value-produced")
  })

  it("leaves the optional native addons out of the bundle", () => {
    // They are imports the bundle still makes at runtime and fails to resolve,
    // which is exactly what puts discord.js on its pure-JavaScript fallbacks.
    expect(bundle).toContain("zlib-sync")
  })

  it("refuses to write over an Export that is already there", async () => {
    await expect(
      exportSingleFile(helloProject(), { outputDirectory: directory })
    ).rejects.toThrowError(ExportError)
  })
})

describe("running the Single File on a real Node.js", () => {
  let discord: FakeDiscordServer
  let bot: ChildProcess
  let output = ""

  beforeAll(async () => {
    discord = await startFakeDiscordServer()

    bot = spawn(process.execPath, [join(directory, SINGLE_FILE_NAME)], {
      cwd: directory,
      env: {
        ...process.env,
        DISCORD_TOKEN: TOKEN,
        DISCORD_API_URL: discord.apiBaseUrl
      },
      stdio: ["ignore", "pipe", "pipe"]
    })
    bot.stdout?.on("data", chunk => {
      output += String(chunk)
    })
    bot.stderr?.on("data", chunk => {
      output += String(chunk)
    })
  }, SLOW)

  afterAll(async () => {
    bot?.kill()
    // Windows kills asynchronously, and a live process holding the Export's
    // directory open is what makes deleting it fail.
    if (bot !== undefined && bot.exitCode === null) await Promise.race([died(bot), delay(10_000)])
    await discord?.close()
  })

  it(
    "starts, connects to the gateway, and registers its commands globally",
    async () => {
      const registration = await Promise.race([
        discord.waitForRegistration(),
        died(bot).then(reason => {
          throw new Error(`the exported bot exited before registering: ${reason}\n${output}`)
        }),
        // A bot that hangs is the interesting failure, so the timeout is ours
        // rather than the test runner's: what it printed is the only clue.
        delay(SLOW / 2).then(() => {
          throw new Error(
            `the exported bot never registered its commands. asked Discord for: ${discord.requests.join(", ") || "nothing"}\n${output}`
          )
        })
      ])

      expect(registration.scope).toBe("global")
      expect(registration.commands).toEqual([
        { name: "hello", description: "Says hello", options: [] }
      ])
    },
    SLOW
  )
})

describe("Exporting somewhere that is not there yet", () => {
  it(
    "creates the directory it was pointed at",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "bot-inventor-export-new-"))
      const target = join(parent, "export")

      try {
        const exported = await exportSingleFile(helloProject(), { outputDirectory: target })

        expect(exported.path).toBe(join(target, SINGLE_FILE_NAME))
        expect(exported.bytes).toBeGreaterThan(0)
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    },
    SLOW
  )

  it(
    "replaces a previous Export when told to",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "bot-inventor-export-over-"))
      await writeFile(join(parent, SINGLE_FILE_NAME), "an older Export")

      try {
        const exported = await exportSingleFile(helloProject(), {
          outputDirectory: parent,
          overwrite: true
        })

        expect(await readFile(exported.path, "utf8")).not.toBe("an older Export")
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    },
    SLOW
  )
})

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds).unref()
  })
}

/** Resolves when the child process is gone, describing how it went. */
function died(child: ChildProcess): Promise<string> {
  return new Promise(resolve => {
    child.once("exit", (code, signal) => resolve(`code ${code}, signal ${signal}`))
    child.once("error", error => resolve(String(error)))
  })
}
