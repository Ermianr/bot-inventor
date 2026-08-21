import { indent, type NodeCatalogue } from "@bot-inventor/nodes"
import type { TraceEvent } from "@bot-inventor/runtime"
import type { Project } from "@bot-inventor/schema"
import { z } from "zod"

import { compile } from "./compile.js"
import { DEFINE_BOT } from "./module.js"
import { TOKEN_VARIABLE } from "./node-project.js"

/**
 * A Session: one run of a Project in Development Mode, on the Node.js sidecar.
 *
 * Both sides of it live here. The application writes the entry point rendered
 * below into a folder of its own, drops the pre-bundled Runtime beside it, and
 * runs it on the sidecar; the bot writes back one line per event, and
 * `readSessionLine` is what turns those lines into something the output panel
 * can use.
 *
 * Tracing rides this pipe as well, one message per event, which is what lets
 * the Canvas light up as the bot works. It is the busiest thing on here by far,
 * and it is why the reading end is written to keep going past a message it does
 * not understand rather than to stop at it.
 *
 * The pipe carries no token in either direction. The token reaches the bot on
 * the child process's environment, and `redactSecret` is the last line of
 * defence for the case where the bot prints it back at us anyway.
 */

/** The file the sidecar is pointed at. */
export const SESSION_ENTRY_NAME = "bot.mjs"

/**
 * The pre-bundled Runtime the entry point imports, which the application places
 * beside it. A Session resolves nothing: there is no `node_modules` next to it
 * and no install step between pressing Run and the bot connecting.
 */
export const SESSION_RUNTIME_NAME = "runtime.mjs"

/**
 * What marks a line as the Session talking to the application rather than the
 * bot printing something. Anything the bot's own code writes is output, which
 * is why this has to be a string nobody writes by accident.
 */
export const SESSION_MESSAGE_PREFIX = "@botinv "

/** What replaces a Secret in anything the user is shown. */
const REDACTION = "[redacted]"

/**
 * A Tracing event as it arrives from the sidecar.
 *
 * It restates `TraceEvent` because this side of the pipe cannot trust the other
 * one: what comes back is text a process wrote, and the Canvas is handed only
 * what this describes. The two are kept in step by `traceEventSchema` being
 * declared to satisfy it.
 */
const traceEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("node-entered"),
    run: z.number(),
    flow: z.string(),
    node: z.string()
  }),
  z.object({
    kind: z.literal("node-completed"),
    run: z.number(),
    flow: z.string(),
    node: z.string()
  }),
  z.object({
    kind: z.literal("wire-carried"),
    run: z.number(),
    flow: z.string(),
    wire: z.string(),
    /** Already text: Tracing serialises a value for display before sending it. */
    value: z.string()
  })
]) satisfies z.ZodType<TraceEvent>

const sessionMessageSchema = z.discriminatedUnion("kind", [
  /**
   * How the start went. `ready` means connected and registered; `failed` comes
   * with a `reason`, which is what lets the application say the token is the
   * problem instead of showing a stack trace.
   *
   * The other two states a Session can be in — connecting and stopped — are the
   * application's to know: nothing running on the sidecar can report them.
   */
  z.object({
    kind: z.literal("status"),
    status: z.enum(["ready", "failed"]),
    reason: z.enum(["token", "unknown"]).optional(),
    message: z.string().optional()
  }),
  /** What registration did, so a rename does not look like a vanished command. */
  z.object({
    kind: z.literal("commands-registered"),
    registered: z.array(z.string()),
    deleted: z.array(z.string())
  }),
  /**
   * A Flow that stopped because an action failed and its Failure Port was free.
   * `run` is absent when nothing was running — a bot that broke outside any
   * Flow of its own has no run to point at.
   */
  z.object({
    kind: z.literal("flow-failed"),
    flow: z.string(),
    node: z.string(),
    message: z.string(),
    run: z.number().optional()
  }),
  /** One Tracing event: a Node entered or completed, or a Wire's value. */
  z.object({
    kind: z.literal("trace"),
    event: traceEventSchema
  })
])

/** Everything the bot says on purpose. */
export type SessionMessage = z.infer<typeof sessionMessageSchema>

/** A line of the bot's own output, for the panel. */
export type SessionOutput = { kind: "output"; text: string }

export type RenderDevelopmentSessionOptions = {
  /**
   * The server the commands are registered to. Development Mode registers to
   * one server because guild commands take effect immediately, where global
   * ones roll out on Discord's own schedule; leaving it out registers globally.
   */
  testServerId?: string
  /** Overridable so a test can render against a catalogue of its own. */
  catalogue?: NodeCatalogue
}

/**
 * Renders the entry point of a Session: the Project in Development Mode, with
 * the reporting the application listens for wrapped around it.
 *
 * It is the same compilation an Export performs, in the other mode — there is
 * no interpreter here and there is not going to be one (ADR 0001). What differs
 * is only what surrounds it: Tracing goes somewhere, failures go somewhere, and
 * a start that fails is reported rather than printed.
 */
export function renderDevelopmentSession(
  project: Project,
  options: RenderDevelopmentSessionOptions
): string {
  const built = compile(project, { mode: "development", catalogue: options.catalogue })
  const guild =
    options.testServerId === undefined || options.testServerId.length === 0
      ? []
      : [`  guildId: ${JSON.stringify(options.testServerId)},`]

  return `${[
    "// Generated by Bot Inventor. Do not edit by hand.",
    "// This is a Development Mode Session. It is written fresh on every Run and",
    "// is not the bot you Export.",
    `import { createDiscordRuntime } from "./${SESSION_RUNTIME_NAME}"`,
    "",
    "/** Declares this bot's Flows on the Runtime it is given. */",
    `export function ${DEFINE_BOT}(runtime) {`,
    indent(built.program),
    "}",
    "",
    "/** One line per event, which is what Bot Inventor reads on the other end. */",
    "function send(message) {",
    `  process.stdout.write(${JSON.stringify(SESSION_MESSAGE_PREFIX)} + JSON.stringify(message) + "\\n")`,
    "}",
    "",
    "// A message rather than an object: a stack trace means nothing to someone",
    "// who has never written code.",
    "function describe(error) {",
    "  if (error instanceof Error) return error.message",
    "  return String(error)",
    "}",
    "",
    "// Discord answers a bad token with a 401 long before anything else can go",
    "// wrong, and that is the one failure the user can actually fix themselves.",
    "function rejectedTheToken(error) {",
    '  if (error !== null && typeof error === "object" && error.code === "TokenInvalid") return true',
    "  return /invalid token|401|unauthorized/i.test(describe(error))",
    "}",
    "",
    "// The token is never in this file: it arrives on the environment.",
    "const runtime = await createDiscordRuntime({",
    `  token: process.env.${TOKEN_VARIABLE} ?? "",`,
    ...guild,
    '  onCommandsRegistered: result => send({ kind: "commands-registered", registered: result.registered, deleted: result.deleted }),',
    '  onFailure: failure => send({ kind: "flow-failed", flow: failure.flow, node: failure.node, message: describe(failure.error), run: failure.run }),',
    '  onTrace: event => send({ kind: "trace", event }),',
    '  onUnexpectedError: error => send({ kind: "flow-failed", flow: "", node: "", message: describe(error) })',
    "})",
    "",
    `${DEFINE_BOT}(runtime)`,
    "",
    "// Losing the pipe means Bot Inventor is gone. Stopping here as well is what",
    "// keeps a crash of the application from leaving a bot running on Discord.",
    'process.stdin.on("end", () => process.exit(0))',
    "process.stdin.resume()",
    "",
    "try {",
    "  await runtime.start()",
    '  send({ kind: "status", status: "ready" })',
    "} catch (error) {",
    '  send({ kind: "status", status: "failed", reason: rejectedTheToken(error) ? "token" : "unknown", message: describe(error) })',
    "  await runtime.stop().catch(() => {})",
    "  process.exit(1)",
    "}"
  ].join("\n")}\n`
}

/**
 * Reads one line the sidecar wrote.
 *
 * Anything that is not a message the Session sent on purpose is the bot's own
 * output, and belongs in the panel: `console.log` from a future Node, a warning
 * from discord.js, a crash. The one thing that is dropped is a message shaped
 * like ours that this build does not understand — showing raw protocol to the
 * user would be worse than showing nothing.
 */
export function readSessionLine(line: string): SessionMessage | SessionOutput | undefined {
  if (!line.startsWith(SESSION_MESSAGE_PREFIX)) return { kind: "output", text: line }

  const body = line.slice(SESSION_MESSAGE_PREFIX.length)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // Our prefix in something the bot printed itself. It is output, not a
    // message, and the user is the one who needs to see it.
    return { kind: "output", text: line }
  }

  const message = sessionMessageSchema.safeParse(parsed)
  return message.success ? message.data : undefined
}

/**
 * Hides a Secret in anything the user is about to be shown.
 *
 * The bot is not supposed to print its token, but it is handed one, and a
 * library logging a failed request with its headers is exactly the accident
 * this exists for. It is applied to every line before the panel sees it.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (secret === undefined || secret.length === 0) return text
  return text.split(secret).join(REDACTION)
}
