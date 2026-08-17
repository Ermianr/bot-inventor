import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"

import { translate } from "@/i18n/messages"

/**
 * Where a bot token is typed, wherever it is typed.
 *
 * It is one component because it is one decision: the field is a password
 * field, it starts empty, and it never shows what is already stored. A Project
 * gets a token when it is created and gets another one from Project Options,
 * and the second of those must not be a second answer to any of that.
 *
 * What a bot token is and where it comes from is written under it. It is the
 * one thing here that somebody who has never made a Discord bot cannot guess,
 * and a form that assumes they can is where they stop.
 *
 * `stored` is what the field is allowed to know about a token that already
 * exists: whether there is one. Nothing hands one back.
 */
export function SecretField({
  id,
  testId,
  value,
  onChange,
  stored
}: {
  id: string
  testId: string
  value: string
  onChange: (secret: string) => void
  /** Whether a token is already stored, or `undefined` where none can be. */
  stored?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{translate("run.token.label")}</Label>
      <Input
        id={id}
        data-testid={testId}
        type="password"
        autoComplete="off"
        placeholder={translate("run.token.placeholder")}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {stored === undefined ? null : (
        <p className="text-muted-foreground text-xs" data-testid={`${testId}-state`}>
          {translate(stored ? "project.token.present" : "project.token.absent")}
        </p>
      )}
      <p className="text-muted-foreground text-xs">{translate("project.token.help")}</p>
    </div>
  )
}
