import { Button } from "@bot-inventor/ui/components/button"
import { Input } from "@bot-inventor/ui/components/input"
import { cn } from "@bot-inventor/ui/lib/utils"
import { PencilIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

/**
 * A name the user reads, with a pencil that turns it into a field.
 *
 * The Project name and every Flow name are renamed with this same gesture, so
 * the gesture is written once: Enter confirms, Escape cancels, clicking away
 * confirms too — a name someone typed is work, and losing it to a stray click
 * is worse than a rename they can do again — and a blank name is refused
 * without leaving the field, because the alternative is a row the user cannot
 * tell apart from another one.
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
  const pencil = useRef<HTMLButtonElement>(null)
  /** Set when the keyboard closed the field, so the pencil is focused again. */
  const returningFocus = useRef(false)
  /** Set once the field is on its way out, so blur does not confirm twice. */
  const settled = useRef(false)

  useEffect(() => {
    if (typed !== undefined || !returningFocus.current) return
    returningFocus.current = false
    // The field is gone; without this the focus is on nothing and the next Tab
    // starts again from the top of the page.
    pencil.current?.focus()
  }, [typed])

  if (typed === undefined) {
    return (
      <span className={cn("flex items-center gap-1", className)}>
        <span data-testid={testId}>{name}</span>
        <Button
          ref={pencil}
          size="icon-xs"
          variant="ghost"
          aria-label={editLabel}
          data-testid={`${testId}-edit`}
          onClick={() => {
            settled.current = false
            setTyped(name)
          }}
        >
          <PencilIcon />
        </Button>
      </span>
    )
  }

  /** Hands the name over, unless it is blank. Says whether it went. */
  const confirm = (value: string): boolean => {
    const trimmed = value.trim()
    // Refusing rather than closing: the user is left in front of what they
    // typed, which is the only place they can fix it.
    if (trimmed.length === 0) return false
    settled.current = true
    onRename(trimmed)
    return true
  }

  const close = () => {
    settled.current = true
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
        // Enter is how a candidate is accepted while composing with an IME or a
        // dead key. Confirming there would store half a word and close the
        // field on it.
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          // The pencil takes the focus back below, and the key is still down:
          // without this the same Enter reaches it and opens the field again.
          event.preventDefault()
          if (!confirm(typed)) return
          returningFocus.current = true
          close()
        }
        if (event.key === "Escape") {
          returningFocus.current = true
          close()
        }
      }}
      // Clicking away confirms. The value is read off the field rather than
      // from state because a blur can arrive after the field is already gone,
      // and `settled` is what stops that one from renaming a second time.
      onBlur={event => {
        if (settled.current) return
        confirm(event.target.value)
        close()
      }}
    />
  )
}
