import { Button } from "@bot-inventor/ui/components/button"

import { translate } from "@/i18n/messages"
import type { Session, SessionStatus } from "@/session/use-session"

/**
 * Starting and stopping the bot, and the light saying which of those is true.
 *
 * It is a piece of its own rather than part of the Console, because the Console
 * is the record of a run and this is the run: these controls belong in the Menu
 * Bar, where every editor puts them, and they sit in the Console's header only
 * until the Menu Bar takes them (#62). Moving them is then moving one element.
 *
 * The token is not asked for. It is in the operating system keychain under the
 * Project, and the only thing that reads it is the shell that starts the bot —
 * this side never sees one.
 */
export function RunControls({ session, testServerId }: { session: Session; testServerId: string }) {
  const running = session.status === "connecting" || session.status === "ready"

  return (
    <div className="flex items-center gap-2">
      <Status status={session.status} />

      <Button
        size="xs"
        data-testid="run-start"
        onClick={() => void session.start({ testServerId })}
        disabled={running}
      >
        {translate("run.start")}
      </Button>

      <Button
        size="xs"
        variant="outline"
        data-testid="run-stop"
        onClick={() => void session.stop()}
        disabled={!running}
      >
        {translate("run.stop")}
      </Button>
    </div>
  )
}

/** Stopped, connecting, ready or failed — the one thing the user looks at. */
function Status({ status }: { status: SessionStatus }) {
  const tone: Record<SessionStatus, string> = {
    stopped: "bg-muted-foreground",
    connecting: "bg-amber-500",
    ready: "bg-emerald-500",
    failed: "bg-destructive"
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
      data-testid="run-status"
      data-status={status}
    >
      <span aria-hidden className={`size-2 rounded-full ${tone[status]}`} />
      {translate(`run.status.${status}`)}
    </span>
  )
}
