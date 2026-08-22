import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"

import { helloProject, requireFirst } from "@bot-inventor/schema/fixtures"

import { delay, died, stop } from "./child-process.js"
import { ExportError } from "./export-error.js"
import { exportNodeProject } from "./export-node-project.js"
import { type FakeDiscordServer, startFakeDiscordServer } from "./fake-discord-server.js"
import { ENTRY_FILE_NAME, FLOWS_DIRECTORY, TOKEN_VARIABLE } from "./node-project.js"

/**
 * The Node Project's own second seam: a folder written to disk, installed with
 * the real npm, and run by the real Node.js binary against a fake Discord.
 *
 * Nothing cheaper can answer the question this format actually raises. The
 * Single File proves itself by running with no `node_modules`; this one has to
 * prove the opposite — that its `package.json` asks for the right things, that
 * the vendored Runtime resolves from where it was copied to, and that the files
 * import each other correctly once they are separate modules on disk.
 *
 * It is slow: one `npm install` over the network and one child process. There
 * is one of it for that reason.
 */

const TOKEN = "not-a-real-token.aaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb"

/** Installing discord.js takes tens of seconds on a cold npm cache. */
const SLOW = 300_000

/**
 * npm is a shell script rather than a binary, so it is run through a shell as a
 * whole command line: `spawn` refuses a batch file on Windows without one, and
 * passing arguments separately alongside `shell: true` is deprecated.
 */
const INSTALL = "npm install --no-audit --no-fund"

let directory: string
let written: readonly string[]

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bot-inventor-node-project-"))
  written = (await exportNodeProject(helloProject(), { outputDirectory: directory })).files
}, SLOW)

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("the folder an Export writes", () => {
  it("splits the bot across readable source files", async () => {
    expect(written).toContain(ENTRY_FILE_NAME)
    expect(written).toContain("src/flows/hello.js")
    expect(written).toContain("package.json")
    expect(written).toContain(".env.example")
    expect(written).toContain("README.md")
  })

  it("carries the Runtime beside the Flows, as source rather than as a bundle", async () => {
    const runtime = written.filter(path => path.startsWith("src/runtime/"))

    expect(runtime).toContain("src/runtime/index.js")
    // The fake Runtime our own tests run against has no business in a hosted bot.
    expect(runtime).not.toContain("src/runtime/testing.js")
    // Vendored source keeps its comments: unreadable output would fail the format.
    expect(await read("src/runtime/discord-js-runtime.js")).toContain("/**")
  })

  it("leaves no source map behind pointing at files it did not copy", async () => {
    expect(await read("src/runtime/index.js")).not.toContain("sourceMappingURL")
    expect(written.filter(path => path.endsWith(".map"))).toEqual([])
  })

  it("asks npm for discord.js at the version the vendored Runtime is built against", async () => {
    const manifest = JSON.parse(await read("package.json")) as {
      dependencies: Record<string, string>
    }

    expect(manifest.dependencies["discord.js"]).toMatch(/^\^\d+\./)
    expect(manifest.dependencies.dotenv).toMatch(/^\^\d+\./)
    // A workspace range is the failure mode worth naming: it installs here and
    // nowhere else.
    for (const range of Object.values(manifest.dependencies)) {
      expect(range).not.toContain(":")
    }
  })

  it("carries no Tracing instrumentation and no token", async () => {
    const sources = await Promise.all(
      written.filter(path => !path.startsWith("src/runtime/")).map(read)
    )
    const everything = sources.join("\n")

    expect(everything).not.toContain("node-entered")
    expect(everything).not.toContain("value-produced")
    // Exporting takes no token to begin with, so there is none to leak: what
    // this pins down is that the folder asks the environment for it.
    expect(everything).toContain(`process.env.${TOKEN_VARIABLE}`)
    expect(everything).not.toContain(TOKEN)
  })

  it("refuses to write over an Export that is already there", async () => {
    await expect(
      exportNodeProject(helloProject(), { outputDirectory: directory })
    ).rejects.toThrowError(ExportError)
  })

  it(
    "replaces a previous Export when told to",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "bot-inventor-node-project-over-"))
      await writeFile(join(parent, "package.json"), '{ "name": "an-older-export" }')

      try {
        await exportNodeProject(helloProject(), { outputDirectory: parent, overwrite: true })

        expect(await readFile(join(parent, "package.json"), "utf8")).not.toContain(
          "an-older-export"
        )
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    },
    SLOW
  )

  it(
    "takes the file of a renamed Flow away with it, rather than leaving a dead one behind",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "bot-inventor-node-project-rename-"))

      try {
        await exportNodeProject(helloProject(), { outputDirectory: parent })

        const renamed = helloProject()
        const flow = requireFirst(renamed.flows, "Flow")
        flow.name = "Greeting"
        const again = await exportNodeProject(renamed, {
          outputDirectory: parent,
          overwrite: true
        })

        expect(again.files).toContain("src/flows/greeting.js")
        // Left behind, it is a file nothing imports that still looks live in a
        // folder the user is about to commit.
        expect(await tree(parent)).not.toContain("src/flows/hello.js")
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    },
    SLOW
  )
})

describe("installing and running the exported folder", () => {
  let discord: FakeDiscordServer
  let bot: ChildProcess
  let output = ""

  beforeAll(async () => {
    const install = await run(INSTALL, directory)
    if (install.code !== 0) {
      throw new Error(
        `npm install failed in the Export with code ${install.code}\n${install.output}`
      )
    }

    discord = await startFakeDiscordServer()

    bot = spawn(process.execPath, [join(directory, ENTRY_FILE_NAME)], {
      cwd: directory,
      env: {
        ...process.env,
        [TOKEN_VARIABLE]: TOKEN,
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
    await stop(bot)
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
        delay(60_000).then(() => {
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
    "creates the folder it was pointed at",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "bot-inventor-node-project-new-"))
      const target = join(parent, "export")

      try {
        const exported = await exportNodeProject(helloProject(), { outputDirectory: target })

        expect(exported.path).toBe(target)
        // Every path reported is a file that is really there, at that path.
        expect(await tree(target)).toEqual(exported.files.toSorted())
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    },
    SLOW
  )

  it(
    "leaves a folder of the user's own alone, even where the names collide",
    async () => {
      const target = await mkdtemp(join(tmpdir(), "bot-inventor-node-project-theirs-"))

      try {
        // `flows` and `src/runtime` belong to an Export outright and are
        // emptied when one is replaced. In a folder that holds no Export they
        // are two ordinary names, and somebody's own work is not ours to
        // delete — there was no Export here to warn them about.
        const theirs = join(target, FLOWS_DIRECTORY, "notes.txt")
        await mkdir(dirname(theirs), { recursive: true })
        await writeFile(theirs, "mine", "utf8")

        await exportNodeProject(helloProject(), { outputDirectory: target })

        expect(await readFile(theirs, "utf8")).toBe("mine")
      } finally {
        await rm(target, { recursive: true, force: true })
      }
    },
    SLOW
  )
})

function read(path: string): Promise<string> {
  return readFile(join(directory, path), "utf8")
}

/** Every file under a directory, as POSIX paths relative to it, sorted. */
async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .toSorted()
}

/** Runs a command to completion, collecting everything it printed. */
function run(commandLine: string, cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise(resolve => {
    const child = spawn(commandLine, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout?.on("data", chunk => {
      output += String(chunk)
    })
    child.stderr?.on("data", chunk => {
      output += String(chunk)
    })
    child.once("error", error => resolve({ code: null, output: `${output}\n${String(error)}` }))
    child.once("close", code => resolve({ code, output }))
  })
}
