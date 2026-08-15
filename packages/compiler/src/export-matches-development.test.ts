import { type ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parameterisedCommandProject } from "@bot-inventor/schema/fixtures"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { delay, died, stop } from "./child-process.js"
import { bundleDevelopmentRuntime } from "./development-runtime.js"
import { renderDevelopmentSession, SESSION_ENTRY_NAME } from "./development-session.js"
import { exportSingleFile, SINGLE_FILE_NAME } from "./export-single-file.js"
import { type FakeDiscordServer, startFakeDiscordServer } from "./fake-discord-server.js"

/**
 * The same Project, run both ways, against the same fake Discord.
 *
 * The promise the two modes make is that an Export behaves like what the user
 * watched work in Development Mode — that Tracing is the only difference (ADR
 * 0001). Nothing else in the suite checks that: the Session tests prove a
 * Session works and the Export tests prove an Export works, each against its
 * own expectations, and two artifacts can both pass their own tests while
 * disagreeing with each other.
 *
 * They now come out of different bundles as well — a Session runs the Runtime
 * built for the sidecar, an Export carries one built for the floor we support
 * (ADR 0007) — which makes the two drifting apart a real thing that could
 * happen rather than a theoretical one.
 *
 * What is compared is what Discord was actually told, because that is the whole
 * of what a bot's behaviour is from outside it.
 *
 * The Project has a command with options on purpose: a bot with no arguments
 * would agree in both modes by having nothing to disagree about.
 */

const TOKEN = "not-a-real-token.aaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb"

/** Two bundles of discord.js and two child processes. */
const SLOW = 180_000

let directory: string
const running: ChildProcess[] = []

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bot-inventor-parity-"))
}, SLOW)

afterAll(async () => {
  for (const child of running) await stop(child)
  await rm(directory, { recursive: true, force: true })
})

/** Starts a bot, waits for it to register, and gives back what Discord got. */
async function registrationOf(
  what: string,
  start: (discord: FakeDiscordServer) => Promise<ChildProcess>
) {
  const discord = await startFakeDiscordServer()
  try {
    const bot = await start(discord)
    running.push(bot)

    return await Promise.race([
      discord.waitForRegistration(),
      died(bot).then(reason => {
        throw new Error(`the ${what} exited before registering: ${reason}`)
      }),
      delay(SLOW / 3).then(() => {
        throw new Error(`the ${what} never registered its commands`)
      })
    ])
  } finally {
    await discord.close()
  }
}

describe("an Export and Development Mode", () => {
  it(
    "register the same commands with Discord",
    async () => {
      const project = parameterisedCommandProject()

      const session = await registrationOf("Session", async discord => {
        const folder = join(directory, "session")
        await bundleDevelopmentRuntime({ outputDirectory: folder })
        await writeFile(
          join(folder, SESSION_ENTRY_NAME),
          // No test server: a Session registers to one server so its commands
          // appear at once, and comparing that to an Export's global
          // registration would be comparing the one thing the two modes are
          // meant to differ on.
          renderDevelopmentSession(project, {})
        )

        return spawn(process.execPath, [join(folder, SESSION_ENTRY_NAME)], {
          cwd: folder,
          env: { ...process.env, DISCORD_TOKEN: TOKEN, DISCORD_API_URL: discord.apiBaseUrl },
          // Left open: its closing is how the bot learns Bot Inventor is gone.
          stdio: ["pipe", "ignore", "ignore"]
        })
      })

      const exported = await registrationOf("Export", async discord => {
        const folder = join(directory, "export")
        await exportSingleFile(project, { outputDirectory: folder })

        return spawn(process.execPath, [join(folder, SINGLE_FILE_NAME)], {
          cwd: folder,
          env: { ...process.env, DISCORD_TOKEN: TOKEN, DISCORD_API_URL: discord.apiBaseUrl },
          stdio: ["ignore", "ignore", "ignore"]
        })
      })

      expect(exported.commands).toEqual(session.commands)
      expect(exported.scope).toBe("global")
      expect(session.scope).toBe("global")

      // Two bots that registered nothing would agree as well, and agreeing on
      // nothing is not the promise being kept here.
      expect(exported.commands).toEqual([
        expect.objectContaining({
          name: "greet",
          options: expect.arrayContaining([expect.objectContaining({ name: "who" })])
        })
      ])
    },
    SLOW
  )
})
