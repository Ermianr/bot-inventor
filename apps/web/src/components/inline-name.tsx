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
 * Whoever placed the pencil can refuse a name for its own reasons as well — a
 * Flow name another Flow already has — and say so, which leaves the user in
 * front of what they typed the same way a blank name does.
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
  editClassName,
  startEditing = false,
  onSelect,
  onRename
}: {
  name: string
  /**
   * Whether this name starts as a field rather than as a word. A Flow the user
   * has just created is named without reaching for the pencil first; it is read
   * once, when the name appears, so a later render does not reopen a field the
   * user has closed.
   */
  startEditing?: boolean
  /** What the pencil is called: "Rename this project", and later this Flow. */
  editLabel: string
  /** What the field is called while the name is being typed. */
  fieldLabel: string
  /** Names the pencil `{testId}-edit` and the field `{testId}-field`. */
  testId: string
  className?: string
  /** For a pencil that is not always shown: the Flow list reveals it on hover. */
  editClassName?: string
  /**
   * Makes the name itself a button. The Flow list chooses a Flow by its name,
   * and a name that is read and a name that is clicked cannot be two controls
   * showing the same word.
   */
  onSelect?: () => void
  /**
   * Takes the trimmed name. Returning `false` refuses it: the field stays open
   * on what the user typed, and saying why is the caller's to do.
   */
  onRename(name: string): boolean | void
}) {
  const [typed, setTyped] = useState<string | undefined>(startEditing ? name : undefined)
  const pencil = useRef<HTMLButtonElement>(null)
  /** Set when the keyboard closed the field, so the pencil is focused again. */
  const returningFocus = useRef(false)
  /** Set once the field is on its way out, so blur does not confirm twice. */
  const settled = useRef(false)
  /**
   * A name the user did not choose — the default a new Flow is given — is
   * selected so the first key they press replaces it. Once, and only for that
   * one: a name they typed themselves is one they are coming back to edit.
   */
  const selectOnFocus = useRef(startEditing)

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
        {onSelect === undefined ? (
          <span data-testid={testId}>{name}</span>
        ) : (
          <button
            type="button"
            className="flex-1 truncate text-left"
            data-testid={testId}
            onClick={onSelect}
          >
            {name}
          </button>
        )}
        <Button
          ref={pencil}
          size="icon-xs"
          variant="ghost"
          aria-label={editLabel}
          className={editClassName}
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

  /** Hands the name over, unless it is blank. Says whether it was taken. */
  const confirm = (value: string): boolean => {
    const trimmed = value.trim()
    // Refusing rather than closing: the user is left in front of what they
    // typed, which is the only place they can fix it.
    if (trimmed.length === 0) return false
    if (onRename(trimmed) === false) return false
    settled.current = true
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
      onFocus={event => {
        if (!selectOnFocus.current) return
        selectOnFocus.current = false
        event.target.select()
      }}
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
      //
      // A name refused here closes the field all the same: the user is already
      // somewhere else on the screen, and a field that follows them around is
      // worse than a rename they can start again. The name they had is what
      // stays, and whoever refused it has said why.
      onBlur={event => {
        if (settled.current) return
        confirm(event.target.value)
        close()
      }}
    />
  )
}
