import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { helloProject } from "@bot-inventor/schema/fixtures"

import { type ExportRequest, type ExportResult, readExportResult } from "./export-protocol.js"
import { SINGLE_FILE_NAME } from "./export-single-file.js"
import {
  BUNDLER_PATH_VARIABLE,
  bundleExporter,
  EXPORTER_BUNDLER_NAME,
  EXPORTER_NAME
} from "./exporter-bundle.js"
import { RUNTIME_DIRECTORY } from "./node-project.js"

/**
 * The exporter as the application actually ships it: the bundle, run by a real
 * Node.js, with no repository under it.
 *
 * This is the same seam as the Export tests and it exists for the same reason.
 * Everything that makes an Export possible in an installed Bot Inventor — a
 * bundler that has to be told where its binary went, a Runtime that is carried
 * rather than resolved, a `node_modules` that is not there — is invisible from
 * inside this repository, where all three happen to be lying around. Only
 * running the bundle can see any of it.
 *
 * It is slow: two bundles of discord.js and a child process. It is one test
 * per thing that can only be seen here, and no more.
 */

/** Bundling discord.js twice takes a while, and so does starting Node.js. */
const SLOW = 180_000

let resources: string
let destination: string

beforeAll(async () => {
  resources = await mkdtemp(join(tmpdir(), "bot-inventor-exporter-"))
  destination = await mkdtemp(join(tmpdir(), "bot-inventor-exported-"))
  await bundleExporter({ outputDirectory: resources })
}, SLOW)

afterAll(async () => {
  await rm(resources, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
})

/** Runs the bundled exporter the way the Tauri side runs it. */
async function ask(request: ExportRequest): Promise<ExportResult> {
  const asked = join(resources, "request.json")
  await writeFile(asked, JSON.stringify(request), "utf8")

  const exporter = spawn(process.execPath, [join(resources, EXPORTER_NAME), asked], {
    env: {
      ...process.env,
      // Bundled, esbuild cannot find its own binary by resolving a package. The
      // application tells it where the binary went, and so does this.
      [BUNDLER_PATH_VARIABLE]: join(resources, EXPORTER_BUNDLER_NAME)
    },
    // Nothing of this repository is on the path it resolves from, which is the
    // situation an installed application is permanently in.
    cwd: tmpdir()
  })

  const said: string[] = []
  exporter.stdout.on("data", chunk => said.push(String(chunk)))

  await new Promise(finished => exporter.on("close", finished))
  return readExportResult(said.join(""))
}

describe("the exporter the application ships", () => {
  it("ships a bundler beside itself, because a bundler cannot be bundled", async () => {
    expect(await readdir(resources)).toEqual(
      expect.arrayContaining([EXPORTER_NAME, EXPORTER_BUNDLER_NAME])
    )
  })

  it(
    "writes a Single File with nothing of this repository to resolve against",
    async () => {
      const result = await ask({
        format: "single-file",
        project: helloProject(),
        outputDirectory: join(destination, "single")
      })

      expect(result).toMatchObject({ kind: "exported", format: "single-file" })
      if (result.kind !== "exported") return

      expect(result.path.endsWith(SINGLE_FILE_NAME)).toBe(true)
      const written = await readFile(result.path, "utf8")
      // discord.js came out of the Runtime baked into the exporter rather than
      // out of a `node_modules` the installed application does not have.
      expect(written).toContain("discord.js")
      expect(written).toContain("process.env.DISCORD_TOKEN")
    },
    SLOW
  )

  it(
    "writes a Node Project carrying the Runtime it was built with",
    async () => {
      const folder = join(destination, "folder")
      const result = await ask({
        format: "node-project",
        project: helloProject(),
        outputDirectory: folder
      })

      expect(result).toMatchObject({ kind: "exported", format: "node-project" })
      if (result.kind !== "exported") return

      expect(result.files).toEqual(
        expect.arrayContaining(["package.json", ".env.example", "README.md"])
      )
      // The vendored Runtime is source in the folder, not a dependency the user
      // would have to install from a registry it was never published to.
      expect(result.files?.some(file => file.startsWith(`${RUNTIME_DIRECTORY}/`))).toBe(true)

      const manifest = JSON.parse(await readFile(join(folder, "package.json"), "utf8"))
      expect(manifest.dependencies["discord.js"]).toBeDefined()
    },
    SLOW
  )

  it(
    "says an Export is already there rather than replacing it",
    async () => {
      const folder = join(destination, "twice")
      const request: ExportRequest = {
        format: "single-file",
        project: helloProject(),
        outputDirectory: folder
      }

      expect(await ask(request)).toMatchObject({ kind: "exported" })
      expect(await ask(request)).toMatchObject({
        kind: "refused",
        reason: "already-exists"
      })
      // Which is a question, so answering it goes through.
      expect(await ask({ ...request, overwrite: true })).toMatchObject({ kind: "exported" })
    },
    SLOW
  )

  it(
    "refuses something that is not a Project instead of failing inside the Compiler",
    async () => {
      const result = await ask({
        format: "single-file",
        project: { not: "a Project" },
        outputDirectory: join(destination, "nonsense")
      } as unknown as ExportRequest)

      expect(result).toMatchObject({ kind: "refused", reason: "failed" })
    },
    SLOW
  )
})
