import { readSessionLine, redactSecret, renderDevelopmentSession } from "@bot-inventor/compiler"
import type { Project } from "@bot-inventor/schema"
import { useCallback, useEffect, useRef, useState } from "react"
import { type MessageKey, translate } from "@/i18n/messages"
import { describeError } from "@/project/project-file"
import type { SessionId } from "@/session/events"
import { describeRefusal } from "@/session/refusal"
import type { SessionGateway } from "@/session/session-gateway"
import { type RunTrace, watchFailure, watchTrace } from "@/session/trace"

/**
 * A Session, as the editor sees it: a status, and everything the bot has said.
 *
 * The Compiler renders the entry point here, in the webview, because compiling
 * is a pure function of the Project; the gateway is handed the result and owns
 * everything after that — the process, its lifetime and its output.
 *
 * The Project is watched while the bot runs, and an edit that changes the bot
 * puts a new one in its place. That is the whole of hot reload, and it is here
 * rather than on a button because the user is meant to never think about it.
 */

/**
 * What the user is told about their bot. `connecting` and `stopped` are the
 * application's own knowledge: the bot can only report the two it is around for.
 */
export type SessionStatus = "stopped" | "connecting" | "ready" | "failed"

/** One line in the output panel. */
export type SessionEntry = {
  id: number
  text: string
  /** `problem` is what the panel colours: a failure, not news. */
  tone: "output" | "note" | "problem"
}

/**
 * How long a bot gets to finish connecting before the editor gives up on it.
 *
 * Connecting to Discord is a couple of seconds' work; anything past this is a
 * network that is not going to answer. It is generous rather than tight because
 * the cost of being wrong is asymmetric: a user told their bot failed when it
 * was about to connect goes looking for a problem that was never there.
 */
const CONNECTING_LIMIT = 30_000

/**
 * How long an edit waits before the bot is rebuilt around it.
 *
 * It is a pause, not a throttle: every edit pushes it back, so typing a command
 * name restarts the bot once, when the typing stops, rather than once per
 * letter. Short enough that the user is still looking at the screen when the
 * bot comes back, long enough that a normal burst of typing is one restart.
 */
export const RELOAD_DELAY = 400

/** What a bot needs to be started, kept so the next one can be started the same. */
type Running = {
  testServerId: string
  secret: string
  /** The entry point the running bot was started on: what an edit is compared to. */
  entry: string
}

export type Session = {
  status: SessionStatus
  entries: readonly SessionEntry[]
  /** The run the Canvas is showing, or nothing when the bot has not run yet. */
  trace: RunTrace | undefined
  /**
   * What went wrong, already translated for the user. It is usually a bot that
   * would not start, but an edit that does not compile also lands here while
   * the previous bot keeps running.
   */
  problem: string | undefined
  start(options: { testServerId: string; secret: string }): Promise<void>
  stop(): Promise<void>
}

export function useSession(project: Project, shell: SessionGateway): Session {
  const [status, setStatus] = useState<SessionStatus>("stopped")
  const [entries, setEntries] = useState<readonly SessionEntry[]>([])
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trace, setTrace] = useState<RunTrace | undefined>(undefined)

  /**
   * The token as it currently sits in the field. The Tauri side redacts what
   * the bot prints, because it is the only side that has the stored token; this
   * covers the one it does not know about — a token typed but not yet saved.
   */
  const typed = useRef("")
  const nextId = useRef(0)
  const givingUp = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * The bot the editor is listening to. A reload starts another one while this
   * one is still dying, and everything the dead one says afterwards carries its
   * own number and is dropped here.
   */
  const current = useRef<SessionId>(0)
  const nextSession = useRef(1)

  /** What is on the sidecar, or nothing when no bot is meant to be running. */
  const running = useRef<Running | undefined>(undefined)

  /** Nothing is waiting on the bot to connect any more, either way. */
  const settled = useCallback(() => {
    clearTimeout(givingUp.current)
    givingUp.current = undefined
  }, [])

  const say = useCallback((text: string, tone: SessionEntry["tone"]) => {
    setEntries(previous => [...previous, { id: nextId.current++, text, tone }])
  }, [])

  const note = useCallback(
    (key: MessageKey, values?: Record<string, string>) => {
      say(translate(key, values), "note")
    },
    [say]
  )

  useEffect(() => {
    const stopListening = [
      shell.onOutput(event => {
        if (event.session !== current.current) return

        const line = redactSecret(event.line, typed.current)
        const message = readSessionLine(line)
        if (message === undefined) return

        switch (message.kind) {
          case "output":
            say(message.text, event.stream === "stderr" ? "problem" : "output")
            return
          case "status":
            settled()
            if (message.status === "ready") {
              setStatus("ready")
              setProblem(undefined)
              return
            }
            setStatus("failed")
            running.current = undefined
            setProblem(
              message.reason === "token"
                ? translate("run.failure.token")
                : translate("run.failure.unknown", { message: message.message ?? "" })
            )
            return
          case "commands-registered":
            note("run.registered", { commands: message.registered.join(", ") })
            if (message.deleted.length > 0) {
              note("run.deleted", { commands: message.deleted.join(", ") })
            }
            return
          case "flow-failed":
            setTrace(watching => watchFailure(watching, message))
            say(
              translate("run.failure.flow", { flow: message.flow, message: message.message }),
              "problem"
            )
            return
          case "trace":
            setTrace(watching => watchTrace(watching, message.event))
            return
        }
      }),

      shell.onExit(event => {
        // The bot a reload replaced dies after its replacement is up. Only the
        // one being listened to going means the bot stopped.
        if (event.session !== current.current) return

        settled()
        running.current = undefined
        // A start that failed has already said why, and that is more useful
        // than reporting that the process it left behind is gone.
        setStatus(previous => (previous === "failed" ? previous : "stopped"))
      })
    ]

    return () => {
      settled()
      for (const stop of stopListening) stop()
    }
  }, [shell, say, note, settled])

  /**
   * Puts a bot on the sidecar, whether it is the first one or the one an edit
   * asked for. The panel is only emptied for a first Run: a reload is meant to
   * be something the user reads straight through.
   */
  const launch = useCallback(
    async (entry: string, options: { testServerId: string; secret: string }) => {
      // Taking the number first is what closes the gap: from here on the bot
      // being replaced is already somebody the editor does not listen to.
      const session = nextSession.current++
      current.current = session
      running.current = { ...options, entry }

      typed.current = options.secret
      setProblem(undefined)
      // The Canvas belongs to the bot that is running: runs are numbered from
      // one again, and what the last bot did is not this one's doing.
      setTrace(undefined)
      setStatus("connecting")

      // A bot that spawns and then hangs on the gateway would otherwise leave
      // the panel saying "connecting" for as long as the user is willing to
      // look at it. Stopping is what makes Run pressable again.
      settled()
      givingUp.current = setTimeout(() => {
        if (current.current !== session) return
        void shell.stop().catch(() => {})
        running.current = undefined
        setStatus("failed")
        setProblem(translate("run.failure.timeout"))
      }, CONNECTING_LIMIT)

      try {
        await shell.start({ projectId: project.id, entry, session })
      } catch (error) {
        if (current.current !== session) return
        settled()
        running.current = undefined
        setStatus("failed")
        setProblem(describeRefusal(error))
      }
    },
    [project.id, settled, shell]
  )

  const stop = useCallback(async () => {
    settled()
    // Nothing is meant to be running, so nothing is listened to and no edit
    // brings the bot back on its own.
    running.current = undefined
    current.current = 0
    try {
      await shell.stop()
    } finally {
      // The button says Stop, so the panel says stopped. Leaving the status on
      // `ready` because the call itself failed would leave the user looking at
      // a bot they cannot stop and cannot restart.
      setStatus("stopped")
    }
  }, [settled, shell])

  const start = useCallback(
    async (options: { testServerId: string; secret: string }) => {
      setEntries([])

      let entry: string
      try {
        entry = renderDevelopmentSession(project, { testServerId: options.testServerId })
      } catch (error) {
        setStatus("failed")
        setProblem(translate("run.failure.build", { message: describeError(error) }))
        return
      }

      await launch(entry, options)
    },
    [launch, project]
  )

  /**
   * Hot reload: an edit made while the bot runs puts a new bot in its place.
   *
   * The restart is a whole process, deliberately — no code is swapped under a
   * bot that is mid-run, because half-replaced code with live state produces
   * bugs nobody can explain, and a Discord bot reconnects on its own in about a
   * second. What is compared is the generated entry point rather than the
   * Project, so moving a Node on the Canvas costs nothing and changing a field
   * or a Wire costs exactly one restart.
   */
  useEffect(() => {
    const bot = running.current
    if (bot === undefined) return

    const reload = setTimeout(() => {
      // It can have been stopped in the meantime, and a bot nobody asked for is
      // worse than an edit that did not take.
      if (running.current === undefined) return

      let entry: string
      try {
        entry = renderDevelopmentSession(project, { testServerId: bot.testServerId })
      } catch (error) {
        // The bot on the sidecar is the last version that compiled, and it is
        // left running: taking away a working bot because of a half-finished
        // edit is the opposite of keeping the user's train of thought.
        setProblem(translate("run.failure.build", { message: describeError(error) }))
        return
      }

      // It compiles, so whatever the last edit could not build is no longer
      // true. Leaving that banner up over a bot that is fine is its own kind of
      // wrong answer.
      setProblem(undefined)

      if (entry === bot.entry) {
        // The edit changed the Canvas but not the bot. Restarting for it would
        // drop the user's connection for nothing.
        return
      }

      note("run.reloading")
      void launch(entry, { testServerId: bot.testServerId, secret: bot.secret })
    }, RELOAD_DELAY)

    return () => clearTimeout(reload)
  }, [project, launch, note])

  return { status, entries, problem, trace, start, stop }
}
