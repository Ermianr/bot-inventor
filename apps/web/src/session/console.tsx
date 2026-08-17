import { Button } from "@bot-inventor/ui/components/button"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"

import { type MessageKey, translate } from "@/i18n/messages"
import type { SessionEntry } from "@/session/use-session"

/**
 * The Console: the record of a running bot, along the bottom of the editor,
 * where an editor puts it.
 *
 * It is a tab strip holding one tab. Tracing joins it later as a sibling, and
 * the strip exists now so that joining it is an entry in a list rather than a
 * rebuild of the panel: a single title turned into a tab afterwards moves every
 * pixel of the header and every test that reads it.
 *
 * Collapsing is the Console's own state and is not remembered between one run of
 * the application and the next. Nothing is lost by starting expanded — the panel
 * is where the bot explains itself — and a preference here would be a third
 * place the editor's shape is written down for a choice made with one click.
 */

/** One tab of the strip, and what is drawn under it. */
type Panel = {
  id: string
  labelKey: MessageKey
  content: ReactNode
}

export function Console({
  entries,
  problem,
  controls
}: {
  entries: readonly SessionEntry[]
  /**
   * What stopped the bot from starting, or from being rebuilt around an edit.
   * It is not one of the entries — it is the Session's current state rather
   * than something that was said once — so it is drawn under them, where the
   * user is already looking for why nothing is happening.
   */
  problem?: string
  /**
   * What the editor hangs in the header beside the tabs. The Console knows what
   * a Session said, not how one is started, so running the bot is passed in
   * rather than built here.
   */
  controls?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const strip = useId()

  const panels: readonly Panel[] = [
    {
      id: "output",
      labelKey: "console.tab.output",
      content: <SessionOutput entries={entries} problem={problem} />
    }
  ]

  const [selected, setSelected] = useState(panels[0]?.id)
  const open = panels.find(panel => panel.id === selected) ?? panels[0]

  return (
    <section
      aria-label={translate("console.title")}
      data-testid="console"
      data-collapsed={collapsed}
      className="flex shrink-0 flex-col border-t bg-background"
    >
      <div className="flex items-center gap-2 px-2">
        <div role="tablist" aria-label={translate("console.title")} className="flex">
          {panels.map(panel => (
            <button
              key={panel.id}
              type="button"
              role="tab"
              id={`${strip}-${panel.id}`}
              aria-selected={panel.id === open?.id}
              aria-controls={`${strip}-${panel.id}-panel`}
              data-testid={`console-tab-${panel.id}`}
              onClick={() => setSelected(panel.id)}
              className="-mb-px border-transparent border-b-2 px-2 py-2 text-muted-foreground text-xs transition-colors hover:text-foreground aria-selected:border-primary aria-selected:text-foreground"
            >
              {translate(panel.labelKey)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {controls}

          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="console-collapse"
            aria-label={translate(collapsed ? "console.expand" : "console.collapse")}
            onClick={() => setCollapsed(was => !was)}
          >
            {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </Button>
        </div>
      </div>

      {collapsed || open === undefined ? null : (
        <div
          role="tabpanel"
          id={`${strip}-${open.id}-panel`}
          aria-labelledby={`${strip}-${open.id}`}
          className="h-56 overflow-y-auto border-t"
        >
          {open.content}
        </div>
      )}
    </section>
  )
}

/** How each kind of Session Output reads: whose voice it is, at a glance. */
const TONE: Record<SessionEntry["tone"], string | undefined> = {
  output: undefined,
  note: "text-muted-foreground",
  problem: "text-destructive"
}

/**
 * Everything the Session has said, newest line in view. That is where a bot
 * that just broke says why, and scrolling to it is not something the user
 * should have to do while it is still happening.
 */
function SessionOutput({
  entries,
  problem
}: {
  entries: readonly SessionEntry[]
  problem: string | undefined
}) {
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (entries.length === 0 && problem === undefined) return
    end.current?.scrollIntoView({ block: "end" })
  }, [entries.length, problem])

  return (
    <div className="p-2 font-mono text-xs" data-testid="session-output">
      {entries.length === 0 && problem === undefined ? (
        <p className="text-muted-foreground">{translate("console.empty")}</p>
      ) : (
        entries.map(entry => (
          <p
            key={entry.id}
            data-testid={`session-entry-${entry.id}`}
            data-tone={entry.tone}
            className={TONE[entry.tone]}
          >
            {entry.text}
          </p>
        ))
      )}

      {problem === undefined ? null : (
        <p data-testid="session-problem" data-tone="problem" className={TONE.problem}>
          {problem}
        </p>
      )}

      <div ref={end} />
    </div>
  )
}
