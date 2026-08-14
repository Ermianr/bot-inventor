import { type ChildProcess, spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { helloProject } from "@bot-inventor/schema/fixtures"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { delay, died, stop } from "./child-process.js"
import { bundleDevelopmentRuntime } from "./development-runtime.js"
import {
  readSessionLine,
  redactSecret,
  renderDevelopmentSession,
  SESSION_ENTRY_NAME,
  type SessionMessage,
  type SessionOutput
} from "./development-session.js"
import { type FakeDiscordServer, startFakeDiscordServer } from "./fake-discord-server.js"

/**
 * A Session on a real Node.js, against a fake Discord.
 *
 * This is the only thing that can prove Run works: the entry point resolves the
 * Runtime placed beside it, the bot reaches the gateway, its commands land on
 * the test server, and the messages the application reads back are the ones it
 * expects. An in-process test never loads the artifact and so can see none of
 * it.
 *
 * The sidecar is not involved. It is a pinned copy of the binary running the
 * test, and pointing that binary at the same folder is what makes this test
 * something the suite can run anywhere.
 */

const TOKEN = "not-a-real-token.aaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb"
const TEST_SERVER_ID = "700000000000000007"

/** Bundling discord.js takes seconds, and starting a child process takes more. */
const SLOW = 120_000

let directory: string
let discord: FakeDiscordServer
let session: ChildProcess
const messages: SessionMessage[] = []
const panel: string[] = []

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "bot-inventor-session-"))
  await bundleDevelopmentRuntime({ outputDirectory: directory })
  await writeFile(
    join(directory, SESSION_ENTRY_NAME),
    renderDevelopmentSession(helloProject(), { testServerId: TEST_SERVER_ID })
  )

  discord = await startFakeDiscordServer()
  session = spawn(process.execPath, [join(directory, SESSION_ENTRY_NAME)], {
    cwd: directory,
    env: { ...process.env, DISCORD_TOKEN: TOKEN, DISCORD_API_URL: discord.apiBaseUrl },
    // stdin is piped and left open on purpose: it is the pipe whose closing
    // tells the bot that Bot Inventor is gone.
    stdio: ["pipe", "pipe", "pipe"]
  })

  read(session)
}, SLOW)

afterAll(async () => {
  await stop(session)
  await discord?.close()
  await rm(directory, { recursive: true, force: true })
})

describe("pressing Run", () => {
  it(
    "starts the bot and registers its commands to the test server",
    async () => {
      const registration = await Promise.race([
        discord.waitForRegistration(),
        died(session).then(reason => {
          throw new Error(`the Session exited before registering: ${reason}\n${transcript()}`)
        }),
        delay(SLOW / 2).then(() => {
          throw new Error(`the Session never registered its commands.\n${transcript()}`)
        })
      ])

      expect(registration.scope).toEqual({ guildId: TEST_SERVER_ID })
      expect(registration.commands).toEqual([
        { name: "hello", description: "Says hello", options: [] }
      ])
    },
    SLOW
  )

  it(
    "reports that it is ready, and what it registered",
    async () => {
      await waitFor(message => message.kind === "status" && message.status === "ready")

      expect(messages).toContainEqual({
        kind: "commands-registered",
        registered: ["hello"],
        deleted: []
      })
    },
    SLOW
  )

  it("never puts the token in the panel", () => {
    expect(panel.join("\n")).not.toContain(TOKEN)
  })
})

describe("pressing Stop", () => {
  it(
    "leaves no process behind",
    async () => {
      await stop(session)

      expect(session.killed || session.exitCode !== null || session.signalCode !== null).toBe(true)
    },
    SLOW
  )
})

/** Splits what the child writes into messages and panel lines, as the app does. */
function read(child: ChildProcess): void {
  const take = (chunk: unknown) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.length === 0) continue
      const message = readSessionLine(redactSecret(line, TOKEN))
      if (message === undefined) continue
      if (message.kind === "output") panel.push((message as SessionOutput).text)
      else messages.push(message)
    }
  }
  child.stdout?.on("data", take)
  child.stderr?.on("data", take)
}

async function waitFor(matches: (message: SessionMessage) => boolean): Promise<void> {
  const deadline = Date.now() + SLOW / 2
  while (Date.now() < deadline) {
    if (messages.some(matches)) return
    if (session.exitCode !== null) break
    await delay(50)
  }
  throw new Error(`the Session never said what was expected.\n${transcript()}`)
}

/** Everything the Session said, which is the only clue when it hangs. */
function transcript(): string {
  return [...messages.map(message => JSON.stringify(message)), ...panel].join("\n")
}
