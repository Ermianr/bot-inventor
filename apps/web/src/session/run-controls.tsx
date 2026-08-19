import { Button } from "@bot-inventor/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@bot-inventor/ui/components/tooltip"
import { PlayIcon, RotateCwIcon, SquareIcon } from "lucide-react"
import type { ReactNode } from "react"

import { useShortcut } from "@/components/use-shortcut"
import { translate } from "@/i18n/messages"
import type { Session, SessionStatus } from "@/session/use-session"

/**
 * F5 runs the bot and Shift+F5 stops it, as they do in a code editor. F5 asks
 * for a Reload while a bot is running, where it would otherwise do nothing:
 * running and reloading are the same gesture at two moments, and a third key
 * for the second one is a key the user has to be told about.
 */
const START_SHORTCUT = "F5"
const RELOAD_SHORTCUT = "F5"
const STOP_SHORTCUT = "Shift+F5"

/**
 * Starting, reloading and stopping the bot, and the light saying which of those
 * is true.
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
export function RunControls({ session }: { session: Session }) {
  const running = session.status === "connecting" || session.status === "ready"
  /**
   * A Reload replaces a bot that is answering with another one. A bot still
   * connecting is never killed to start a second, and a Project the editor
   * cannot build has nothing to be reloaded to — the Session is still shown as
   * outdated there, because it is, and the reason it cannot be put right yet is
   * the problem the Console is already carrying.
   */
  const reloadable = session.status === "ready" && session.outdated && session.problem === undefined

  const start = () => void session.start()
  const stop = () => void session.stop()
  const reload = () => void session.reload()

  // The shortcut is dead exactly while its button is, so neither way of asking
  // for a thing does something the other one refuses.
  useShortcut(START_SHORTCUT, start, !running)
  useShortcut(RELOAD_SHORTCUT, reload, reloadable)
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
        icon={<RotateCwIcon />}
        label={translate("run.reload")}
        shortcut={RELOAD_SHORTCUT}
        testId="run-reload"
        onClick={reload}
        disabled={!reloadable}
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
      {session.outdated && <Outdated />}
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
 * That the bot on Discord is behind the Project on the Canvas: an Outdated
 * Session.
 *
 * It sits beside the light and never in place of it, because being outdated is
 * not being broken — the bot is alive and answering, on code the user has moved
 * on from — and either half on its own is a lie. It says so in words, so that
 * nobody has to have noticed a colour to know it.
 */
function Outdated() {
  return (
    <span
      className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 text-xs dark:text-amber-400"
      data-testid="run-outdated"
    >
      {translate("run.outdated")}
    </span>
  )
}

const STATUS_TONE: Record<SessionStatus, string> = {
  stopped: "bg-muted-foreground",
  connecting: "bg-amber-500",
  ready: "bg-emerald-500",
  failed: "bg-destructive"
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
  const said = translate(`run.status.${status}`)

  return (
    <span
      className="ml-1 inline-flex items-center gap-1.5 text-muted-foreground text-sm"
      data-testid="run-status"
      data-status={status}
    >
      <span className={`size-2 shrink-0 rounded-full ${STATUS_TONE[status]}`} aria-hidden="true" />
      {said}
    </span>
  )
}
