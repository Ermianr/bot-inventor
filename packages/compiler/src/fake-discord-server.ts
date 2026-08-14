import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocketServer } from "ws"

/**
 * A Discord that is not Discord: the REST endpoints and the gateway handshake an
 * exported bot touches on start, and nothing else.
 *
 * It exists for the second test seam. An in-process test cannot see a bad
 * external, a broken import or a malformed bundle, because it never loads the
 * bundle; only spawning the real Node.js binary on the real artifact can. That
 * needs something on the other end of the socket, and this is it — no network,
 * no token, no Discord application.
 */

/** A slash command as the bot registered it, in Discord's own wire shape. */
export type ReceivedCommand = {
  name: string
  description: string
  options?: readonly { name: string; type: number; required: boolean }[]
}

/** One bulk overwrite of a target's commands, as Discord would have received it. */
export type CommandRegistration = {
  /** `global` or the id of the server the commands were registered to. */
  scope: "global" | { guildId: string }
  commands: readonly ReceivedCommand[]
}

export type FakeDiscordServer = {
  /** What to hand the bot as `DISCORD_API_URL`. */
  readonly apiBaseUrl: string
  /** Every command registration received, in order. */
  readonly registrations: readonly CommandRegistration[]
  /** Everything the bot asked for, so a bot that never starts can be told from one that stalls. */
  readonly requests: readonly string[]
  /** Resolves once the bot has registered its commands, which is the last step of its start. */
  waitForRegistration(): Promise<CommandRegistration>
  close(): Promise<void>
}

/** The application id the fake gateway claims, which is what the bot registers against. */
const APPLICATION_ID = "100000000000000001"

export async function startFakeDiscordServer(): Promise<FakeDiscordServer> {
  const registrations: CommandRegistration[] = []
  const requests: string[] = []
  const waiting: ((registration: CommandRegistration) => void)[] = []

  const record = (registration: CommandRegistration) => {
    registrations.push(registration)
    for (const resolve of waiting.splice(0)) resolve(registration)
  }

  // The gateway listens somewhere of its own, as Discord's does, which keeps
  // the WebSocket upgrade off the connection the REST API is served over.
  const gateway = createServer()
  gateway.listen(0, "127.0.0.1")
  await once(gateway, "listening")
  const gatewayUrl = `ws://127.0.0.1:${portOf(gateway)}`

  const sockets = new WebSocketServer({ server: gateway })
  sockets.on("connection", socket => {
    requests.push("gateway connection")

    // HELLO first: the client will not identify until it has one, and the
    // interval is what it paces its heartbeats by.
    send(socket, { op: 10, d: { heartbeat_interval: 45_000 } })

    socket.on("message", raw => {
      const payload = JSON.parse(String(raw)) as { op: number }
      requests.push(`gateway op ${payload.op}`)

      // A heartbeat left unacknowledged makes the client tear the connection
      // down and reconnect, which reads as a bot that never starts.
      if (payload.op === 1) send(socket, { op: 11, d: null })
      if (payload.op === 2) send(socket, ready(gatewayUrl))
    })
  })

  const rest = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    handleRest(request, response, gatewayUrl, record).catch(() => {
      // Something can fail after the response has gone out, and answering twice
      // throws where nothing is waiting to catch it, taking the test runner's
      // worker down instead of failing one test.
      if (response.headersSent) return
      respond(response, 500, { message: "the fake Discord failed" })
    })
  })
  rest.listen(0, "127.0.0.1")
  await once(rest, "listening")

  return {
    apiBaseUrl: `http://127.0.0.1:${portOf(rest)}/api`,
    registrations,
    requests,
    waitForRegistration() {
      const [first] = registrations
      if (first !== undefined) return Promise.resolve(first)
      return new Promise(resolve => waiting.push(resolve))
    },
    async close() {
      sockets.close()
      for (const socket of sockets.clients) socket.terminate()
      rest.close()
      gateway.close()
      await Promise.all([once(rest, "close"), once(gateway, "close")])
    }
  }
}

async function handleRest(
  request: IncomingMessage,
  response: ServerResponse,
  gatewayUrl: string,
  record: (registration: CommandRegistration) => void
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const path = url.pathname.replace(/^\/api\/v\d+/, "")

  if (path === "/gateway/bot") {
    respond(response, 200, {
      url: gatewayUrl,
      shards: 1,
      session_start_limit: { total: 1000, remaining: 999, reset_after: 0, max_concurrency: 1 }
    })
    return
  }

  const commands = /^\/applications\/[^/]+(?:\/guilds\/([^/]+))?\/commands$/.exec(path)
  if (commands !== null) {
    const guildId = commands[1]
    const scope: CommandRegistration["scope"] = guildId === undefined ? "global" : { guildId }

    // Nothing was ever registered before a test starts, so the listing the bot
    // makes to report renames is always empty.
    if (request.method === "GET") {
      respond(response, 200, [])
      return
    }
    if (request.method === "PUT") {
      const body = JSON.parse(await read(request)) as ReceivedCommand[]
      record({ scope, commands: body })
      respond(response, 200, registered(scope, body))
      return
    }
  }

  respond(response, 404, { message: `the fake Discord has no ${request.method} ${path}` })
}

function registered(scope: CommandRegistration["scope"], commands: readonly ReceivedCommand[]) {
  return commands.map((command, index) => ({
    ...command,
    id: `${scope === "global" ? "global" : scope.guildId}-${index}`,
    application_id: APPLICATION_ID
  }))
}

/** The READY dispatch, reduced to the fields discord.js patches onto the client. */
function ready(gatewayUrl: string) {
  return {
    op: 0,
    s: 1,
    t: "READY",
    d: {
      v: 10,
      user: {
        id: "200000000000000002",
        username: "exported-bot",
        discriminator: "0000",
        global_name: null,
        avatar: null,
        bot: true
      },
      guilds: [],
      session_id: "fake-session",
      resume_gateway_url: gatewayUrl,
      shard: [0, 1],
      application: { id: APPLICATION_ID, flags: 0 }
    }
  }
}

function send(socket: { send(data: string): void }, payload: unknown): void {
  socket.send(JSON.stringify(payload))
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(encoded)
  })
  response.end(encoded)
}

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

function portOf(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === "string") {
    throw new Error("the fake Discord is not listening on a port")
  }
  return (address as AddressInfo).port
}
