import { Button } from "@bot-inventor/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@bot-inventor/ui/components/card"
import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"
import { invoke } from "@tauri-apps/api/core"
import { useEffect, useRef, useState } from "react"
import { TestServerPicker } from "@/components/test-server-picker"
import { translate } from "@/i18n/messages"
import { currentProject } from "@/session/current-project"
import { type SessionEntry, type SessionStatus, useSession } from "@/session/use-session"

/**
 * Everything it takes to see the bot alive on Discord: a token, a server to
 * test in, Run, and what the bot is saying.
 *
 * The token is typed here and goes straight to the operating system keychain
 * through the Tauri side. It is never held in the Project, and it is not kept
 * in this component beyond the moment it is saved.
 */
export function RunPanel() {
  const session = useSession(currentProject)
  const [secret, setSecret] = useState("")
  const [stored, setStored] = useState(false)
  const [testServerId, setTestServerId] = useState("")

  useEffect(() => {
    invoke<boolean>("secret_exists", { projectId: currentProject.id })
      .then(setStored)
      .catch(() => setStored(false))
  }, [])

  const save = async () => {
    await invoke("store_secret", { projectId: currentProject.id, secret })
    setStored(true)
  }

  const running = session.status === "connecting" || session.status === "ready"

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("run.title")}</CardTitle>
        <CardDescription>
          <Status status={session.status} />
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="secret">{translate("run.token.label")}</Label>
          <div className="flex gap-2">
            <Input
              id="secret"
              type="password"
              autoComplete="off"
              placeholder={translate("run.token.placeholder")}
              value={secret}
              onChange={event => setSecret(event.target.value)}
            />
            <Button onClick={save} disabled={secret.length === 0}>
              {translate("run.token.save")}
            </Button>
          </div>
          {stored ? (
            <p className="text-muted-foreground text-xs">{translate("run.token.stored")}</p>
          ) : null}
        </div>

        <TestServerPicker
          projectId={currentProject.id}
          value={testServerId}
          onChange={setTestServerId}
        />

        <div className="flex gap-2">
          <Button onClick={() => session.start({ testServerId, secret })} disabled={running}>
            {translate("run.start")}
          </Button>
          <Button variant="outline" onClick={() => session.stop()} disabled={!running}>
            {translate("run.stop")}
          </Button>
        </div>

        {session.problem === undefined ? null : (
          <p className="text-destructive text-xs">{session.problem}</p>
        )}

        <Output entries={session.entries} />
      </CardContent>
    </Card>
  )
}

/** Connecting, ready, stopped or failed — the one thing the user looks at. */
function Status({ status }: { status: SessionStatus }) {
  const tone: Record<SessionStatus, string> = {
    stopped: "bg-muted-foreground",
    connecting: "bg-amber-500",
    ready: "bg-emerald-500",
    failed: "bg-destructive"
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`size-2 rounded-full ${tone[status]}`} />
      {translate(`run.status.${status}`)}
    </span>
  )
}

/** How each kind of line reads in the panel. */
const TONE: Record<SessionEntry["tone"], string | undefined> = {
  output: undefined,
  note: "text-muted-foreground",
  problem: "text-destructive"
}

/**
 * What the bot is saying, so that nobody has to go looking for a log file. It
 * follows the newest line, which is where a bot that just broke says why.
 */
function Output({ entries }: { entries: readonly SessionEntry[] }) {
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (entries.length === 0) return
    end.current?.scrollIntoView({ block: "end" })
  }, [entries.length])

  return (
    <div className="grid gap-1.5">
      <Label>{translate("run.output.title")}</Label>
      <div className="h-64 overflow-y-auto bg-muted/40 p-2 font-mono text-xs ring-1 ring-foreground/10">
        {entries.length === 0 ? (
          <p className="text-muted-foreground">{translate("run.output.empty")}</p>
        ) : (
          entries.map(entry => (
            <p key={entry.id} className={TONE[entry.tone]}>
              {entry.text}
            </p>
          ))
        )}
        <div ref={end} />
      </div>
    </div>
  )
}
