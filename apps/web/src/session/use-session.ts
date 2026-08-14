import { readSessionLine, redactSecret, renderDevelopmentSession } from "@bot-inventor/compiler"
import type { Project } from "@bot-inventor/schema"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useRef, useState } from "react"
import { type MessageKey, translate } from "@/i18n/messages"
import {
  EXIT_EVENT,
  OUTPUT_EVENT,
  type SessionExitEvent,
  type SessionOutputEvent
} from "@/session/events"
import { describeRefusal } from "@/session/refusal"

/**
 * A Session, as the editor sees it: a status, and everything the bot has said.
 *
 * The Compiler renders the entry point here, in the webview, because compiling
 * is a pure function of the Project; the Tauri side is handed the result and
 * owns everything after that — the process, its lifetime and its output.
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

export type Session = {
  status: SessionStatus
  entries: readonly SessionEntry[]
  /** Set whenever the status is `failed`, already translated for the user. */
  problem: string | undefined
  start(options: { testServerId: string; secret: string }): Promise<void>
  stop(): Promise<void>
}

export function useSession(project: Project): Session {
  const [status, setStatus] = useState<SessionStatus>("stopped")
  const [entries, setEntries] = useState<readonly SessionEntry[]>([])
  const [problem, setProblem] = useState<string | undefined>(undefined)

  /**
   * The token as it currently sits in the field. The Tauri side redacts what
   * the bot prints, because it is the only side that has the stored token; this
   * covers the one it does not know about — a token typed but not yet saved.
   */
  const typed = useRef("")
  const nextId = useRef(0)
  const givingUp = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
    const listeners = [
      listen<SessionOutputEvent>(OUTPUT_EVENT, event => {
        const line = redactSecret(event.payload.line, typed.current)
        const message = readSessionLine(line)
        if (message === undefined) return

        switch (message.kind) {
          case "output":
            say(message.text, event.payload.stream === "stderr" ? "problem" : "output")
            return
          case "status":
            settled()
            if (message.status === "ready") {
              setStatus("ready")
              setProblem(undefined)
              return
            }
            setStatus("failed")
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
            say(
              translate("run.failure.flow", { flow: message.flow, message: message.message }),
              "problem"
            )
            return
        }
      }),
      listen<SessionExitEvent>(EXIT_EVENT, () => {
        settled()
        // A start that failed has already said why, and that is more useful
        // than reporting that the process it left behind is gone.
        setStatus(previous => (previous === "failed" ? previous : "stopped"))
      })
    ]

    return () => {
      settled()
      for (const listener of listeners) listener.then(remove => remove()).catch(() => {})
    }
  }, [say, note, settled])

  const stop = useCallback(async () => {
    settled()
    try {
      await invoke("stop_session")
    } finally {
      // The button says Stop, so the panel says stopped. Leaving the status on
      // `ready` because the call itself failed would leave the user looking at
      // a bot they cannot stop and cannot restart.
      setStatus("stopped")
    }
  }, [settled])

  const start = useCallback(
    async ({ testServerId, secret }: { testServerId: string; secret: string }) => {
      typed.current = secret
      setEntries([])
      setProblem(undefined)
      setStatus("connecting")

      // A bot that spawns and then hangs on the gateway would otherwise leave
      // the panel saying "connecting" for as long as the user is willing to
      // look at it. Stopping is what makes Run pressable again.
      settled()
      givingUp.current = setTimeout(() => {
        void stop()
        setStatus("failed")
        setProblem(translate("run.failure.timeout"))
      }, CONNECTING_LIMIT)

      try {
        await invoke("start_session", {
          projectId: project.id,
          entry: renderDevelopmentSession(project, { testServerId })
        })
      } catch (error) {
        settled()
        setStatus("failed")
        setProblem(describeRefusal(error))
      }
    },
    [project, settled, stop]
  )

  return { status, entries, problem, start, stop }
}
