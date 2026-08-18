import { Button } from "@bot-inventor/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@bot-inventor/ui/components/tooltip"
import { PlayIcon, SquareIcon } from "lucide-react"
import type { ReactNode } from "react"

import { useShortcut } from "@/components/use-shortcut"
import { translate } from "@/i18n/messages"
import type { Session, SessionStatus } from "@/session/use-session"

/** F5 runs the bot and Shift+F5 stops it, as they do in a code editor. */
const START_SHORTCUT = "F5"
const STOP_SHORTCUT = "Shift+F5"

/**
 * Starting and stopping the bot, and the light saying which of those is true.
 *
 * It lives in the Menu Bar, where every code editor puts it: running the bot is
 * the gesture the user makes most, and it belongs to the Project as a whole
 * rather than to the Flow that happens to be on the Canvas.
 *
 * The two buttons are icons and nothing else. What they mean is the same
 * triangle and square every player and every editor has drawn for decades, and
 * a row that spells them out spends the Canvas's pixels saying what the user
 * already knows. What is not obvious — the shortcut — is in the tooltip, and
 * what a screen reader needs is the accessible name.
 *
 * The token is not asked for. It is in the operating system keychain under the
 * Project, and the only thing that reads it is the shell that starts the bot —
 * this side never sees one.
 */
export function RunControls({ session, testServerId }: { session: Session; testServerId: string }) {
  const running = session.status === "connecting" || session.status === "ready"

  const start = () => void session.start({ testServerId })
  const stop = () => void session.stop()

  // The shortcut is dead exactly while its button is, so neither way of asking
  // for a thing does something the other one refuses.
  useShortcut(START_SHORTCUT, start, !running)
  useShortcut(STOP_SHORTCUT, stop, running)

  return (
    <div className="flex items-center gap-1">
      <RunButton
        icon={<PlayIcon />}
        label={translate("run.start")}
        shortcut={START_SHORTCUT}
        testId="run-start"
        onClick={start}
        disabled={running}
      />

      <RunButton
        icon={<SquareIcon />}
        label={translate("run.stop")}
        shortcut={STOP_SHORTCUT}
        testId="run-stop"
        onClick={stop}
        disabled={!running}
      />

      <Status status={session.status} />
    </div>
  )
}

/**
 * One icon-only button: the icon for the eye, the same words for everyone else,
 * and the shortcut for whoever wants to stop reaching for the mouse.
 */
function RunButton({
  icon,
  label,
  shortcut,
  testId,
  onClick,
  disabled
}: {
  icon: ReactNode
  label: string
  shortcut: string
  testId: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <Tooltip>
      {/*
        Dead is dead: the button itself carries `disabled`, and not the tooltip
        around it — what a tooltip means by disabled is that it has nothing to
        say, and a button left pressable under one would start a second bot.
      */}
      <TooltipTrigger
        render={<Button size="icon-sm" variant="ghost" disabled={disabled} />}
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{translate("run.shortcut", { action: label, shortcut })}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Stopped, connecting, running or failed — the one thing the user looks at.
 *
 * It is said in words beside its colour, and not by the colour alone: this sits
 * where the Project's name used to, which the window title now carries, and the
 * pixels are better spent on what changes while the bot runs than on what the
 * user chose once. The dot is read at a glance, the word settles what it meant,
 * and nobody has to learn the colours to use the editor.
 */
function Status({ status }: { status: SessionStatus }) {
  const tone: Record<SessionStatus, string> = {
    stopped: "bg-muted-foreground",
    connecting: "bg-amber-500",
    ready: "bg-emerald-500",
    failed: "bg-destructive"
  }

  const said = translate(`run.status.${status}`)

  return (
    <span
      className="ml-1 inline-flex items-center gap-1.5 text-muted-foreground text-sm"
      data-testid="run-status"
      data-status={status}
    >
      <span className={`size-2 shrink-0 rounded-full ${tone[status]}`} aria-hidden="true" />
      {said}
    </span>
  )
}
