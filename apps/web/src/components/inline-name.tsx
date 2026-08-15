import { Button } from "@bot-inventor/ui/components/button"
import { Input } from "@bot-inventor/ui/components/input"
import { cn } from "@bot-inventor/ui/lib/utils"
import { PencilIcon } from "lucide-react"
import { useState } from "react"

/**
 * A name the user reads, with a pencil that turns it into a field.
 *
 * The Project name and every Flow name are renamed with this same gesture, so
 * the gesture is written once: Enter confirms, Escape cancels, and a blank name
 * is refused without leaving the field, because the alternative is a row the
 * user cannot tell apart from another one.
 *
 * The words are props rather than keys resolved in here, since what the pencil
 * is renaming is only known by whoever placed it.
 */
export function InlineName({
  name,
  editLabel,
  fieldLabel,
  testId,
  className,
  onRename
}: {
  name: string
  /** What the pencil is called: "Rename this project", and later this Flow. */
  editLabel: string
  /** What the field is called while the name is being typed. */
  fieldLabel: string
  /** Names the pencil `{testId}-edit` and the field `{testId}-field`. */
  testId: string
  className?: string
  onRename(name: string): void
}) {
  const [typed, setTyped] = useState<string | undefined>(undefined)

  if (typed === undefined) {
    return (
      <span className={cn("flex items-center gap-1", className)}>
        <span data-testid={testId}>{name}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={editLabel}
          data-testid={`${testId}-edit`}
          onClick={() => setTyped(name)}
        >
          <PencilIcon />
        </Button>
      </span>
    )
  }

  const confirm = () => {
    // Refusing rather than closing: the user is left in front of what they
    // typed, which is the only place they can fix it.
    if (typed.trim().length === 0) return
    onRename(typed)
    setTyped(undefined)
  }

  return (
    <Input
      // The pencil is gone the moment the field appears, so the field has to
      // take the focus itself or the keyboard is left on nothing.
      autoFocus
      className={cn("w-48", className)}
      value={typed}
      aria-label={fieldLabel}
      data-testid={`${testId}-field`}
      onChange={event => setTyped(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Enter") confirm()
        if (event.key === "Escape") setTyped(undefined)
      }}
      // Clicking away is backing out, not confirming: the name on screen is
      // still the one the Project has.
      onBlur={() => setTyped(undefined)}
    />
  )
}
