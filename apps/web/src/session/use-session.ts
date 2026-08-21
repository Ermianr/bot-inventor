import { readSessionLine, renderDevelopmentSession } from "@bot-inventor/compiler"
import type { Project } from "@bot-inventor/schema"
import { useCallback, useEffect, useRef, useState } from "react"

import { type MessageKey, translate } from "@/i18n/messages"
import { describeError } from "@/project/describe-error"
import { describeProjectProblem } from "@/project/node-problems"
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
 * The Project and its Test Server are watched while the bot runs, and a change
 * that changes the bot makes the Session an Outdated Session — nothing is
 * replaced until the user asks for a Reload (see ADR 0012).
 */

/**
 * What the user is told about their bot. `connecting` and `stopped` are the
 * application's own knowledge: the bot can only report the two it is around for.
 */
export type SessionStatus = "stopped" | "connecting" | "ready" | "failed"

/** One line the Console shows: Session Output. */
export type SessionEntry = {
  id: number
  text: string
  /** `problem` is what the Console colours: a failure, not news. */
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
 * How long an edit waits before the Project is compared to the running bot.
 *
 * It is a pause, not a throttle: every edit pushes it back, so typing a command
 * name runs the Project through the Compiler once, when the typing stops,
 * rather than once per letter. Nothing is restarted by it any more — what it
 * defers is the comparison that decides whether the Session is outdated.
 */
export const OUTDATED_DELAY = 400

/** The bot that is meant to be running, and what an edit is compared to. */
type Running = {
  /** The entry point the running bot was started on. */
  entry: string
}

export type Session = {
  status: SessionStatus
  /**
   * Whether the running bot is behind the Project on the Canvas: an Outdated
   * Session. It sits beside the status rather than inside it, because a bot can
   * be running perfectly well *and* be running code the user has moved on from,
   * and saying only one of those is a lie.
   *
   * It stays true while the Project will not build: a bot running code that
   * compiles is certainly not the Project on the Canvas, and hiding that half
   * because the other half is also true would be the same lie. What a broken
   * Project takes away is the Reload, not the fact of being behind, and the
   * `problem` beside it is the reason.
   */
  outdated: boolean
  entries: readonly SessionEntry[]
  /** The run the Canvas is showing, or nothing when the bot has not run yet. */
  trace: RunTrace | undefined
  /**
   * What went wrong, already translated for the user. It is usually a bot that
   * would not start, but an edit that does not compile also lands here while
   * the previous bot keeps running.
   */
  problem: string | undefined
  /**
   * No token is asked for. It is in the operating system keychain under the
   * Project, and the shell that starts the bot is the only thing that reads it.
   */
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * Puts the Project as it stands in place of the bot that is running. It does
   * nothing when no bot is running, and keeps everything the Console has said.
   */
  reload(): Promise<void>
}

/**
 * The entry point a Project would run as, or the reason it would not run.
 *
 * Run, Reload and the comparison behind the Outdated Session all need the same
 * two answers and treat them differently — a Run that cannot build has failed,
 * an edit that cannot build leaves the last working bot alone — so what is
 * shared is the question and not what is done with it.
 */
function describeEntry(
  project: Project,
  testServerId: string
): { entry: string } | { problem: string } {
  // A Node that already knows Discord would refuse stops this here, so the user
  // reads the reason on the Canvas instead of watching a bot fail on Discord
  // for something the editor knew.
  const invalid = describeProjectProblem(project)
  if (invalid !== undefined) {
    return { problem: translate("run.failure.node", { message: invalid }) }
  }

  try {
    return { entry: renderDevelopmentSession(project, { testServerId }) }
  } catch (error) {
    return { problem: translate("run.failure.build", { message: describeError(error) }) }
  }
}

/**
 * The Test Server is a parameter rather than something a Run captures, because
 * a Project tried on another server is another bot: picking one mid-run has to
 * reach the machinery that already notices a Project change, instead of being
 * frozen into the Session that happened to start first.
 */
export function useSession(project: Project, shell: SessionGateway, testServerId: string): Session {
  const [status, setStatus] = useState<SessionStatus>("stopped")
  const [entries, setEntries] = useState<readonly SessionEntry[]>([])
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [outdated, setOutdated] = useState(false)
  const [trace, setTrace] = useState<RunTrace | undefined>(undefined)

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
    // The number is taken before the updater rather than inside it: an updater
    // React may call more than once for the same entry must not be what moves
    // the counter along.
    const id = nextId.current++
    setEntries(previous => [...previous, { id, text, tone }])
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

        // What the bot prints is redacted where the token lives, on the shell
        // side. Nothing here ever holds one to redact: the editor stores a
        // token straight into the keychain and is never handed it back.
        const message = readSessionLine(event.line)
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
            setOutdated(false)
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
   * Puts a bot on the sidecar, whether it is the first one or the one a Reload
   * asked for. The Console is only emptied for a first Run: a Reload is meant to
   * be something the user reads straight through.
   */
  const launch = useCallback(
    async (entry: string) => {
      // Taking the number first is what closes the gap: from here on the bot
      // being replaced is already somebody the editor does not listen to.
      const session = nextSession.current++
      current.current = session
      running.current = { entry }

      setProblem(undefined)
      // Whatever the bot is about to be, it is the Project as it stands.
      setOutdated(false)
      // The Canvas belongs to the bot that is running: runs are numbered from
      // one again, and what the last bot did is not this one's doing.
      setTrace(undefined)
      setStatus("connecting")

      // A bot that spawns and then hangs on the gateway would otherwise leave
      // the status saying "connecting" for as long as the user is willing to
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
    // There is no bot left to be behind the Project.
    setOutdated(false)
    try {
      await shell.stop()
    } finally {
      // The button says Stop, so the Console says stopped. Leaving the status on
      // `ready` because the call itself failed would leave the user looking at
      // a bot they cannot stop and cannot restart.
      setStatus("stopped")
    }
  }, [settled, shell])

  const start = useCallback(async () => {
    setEntries([])

    const built = describeEntry(project, testServerId)
    if ("problem" in built) {
      // Nothing was running, so there is no bot to protect: the Run itself is
      // what failed, and the light has to say so.
      setStatus("failed")
      setProblem(built.problem)
      return
    }

    await launch(built.entry)
  }, [launch, project, testServerId])

  const reload = useCallback(async () => {
    // A Reload replaces a bot; with nothing running there is only Run, and the
    // control that asks for this is dead for exactly the same reason.
    if (running.current === undefined) return

    const built = describeEntry(project, testServerId)
    if ("problem" in built) {
      // The control that asks for this is already dead here; a Reload arriving
      // anyway still leaves the bot that works alone and says why.
      setProblem(built.problem)
      setOutdated(true)
      return
    }

    note("run.reloading")
    await launch(built.entry)
  }, [launch, note, project, testServerId])

  /**
   * Whether the running bot is still the Project the user is looking at.
   *
   * What is compared is the generated entry point rather than the Project, so
   * dragging a Node across the Canvas costs nothing and an edit that is undone
   * puts the Session back to matching on its own. The delay is here so that a
   * burst of typing runs the whole Project through the Compiler once, when the
   * typing stops, rather than once per letter.
   */
  useEffect(() => {
    const compare = setTimeout(() => {
      const bot = running.current
      // Nothing is running, so there is nothing to be behind.
      if (bot === undefined) return

      const built = describeEntry(project, testServerId)
      if ("problem" in built) {
        // The bot on the sidecar is the last version that worked, and it is
        // left running while the user finishes the edit that broke this one.
        // It is behind the Canvas — a Project that will not build cannot be the
        // code a running bot is on — and there is nothing to reload it to,
        // which is what the reason beside it says.
        setProblem(built.problem)
        setOutdated(true)
        return
      }

      // It builds, so whatever the last edit could not build is no longer true.
      // Leaving that banner up over a bot that is fine is its own wrong answer.
      setProblem(undefined)
      setOutdated(built.entry !== bot.entry)
    }, OUTDATED_DELAY)

    return () => clearTimeout(compare)
  }, [project, testServerId])

  return { status, outdated, entries, problem, trace, start, stop, reload }
}
