import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"
import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"
import { useState } from "react"

import { SecretField } from "@/components/secret-field"
import { TestServerPicker } from "@/components/test-server-picker"
import { translate } from "@/i18n/messages"
import type { ProjectDetails } from "@/project/use-projects"

/** The three ways a Project begins, all of them ending in this dialog. */
export type ProjectKind = "blank" | "example" | "import"

/** What the dialog says at the top, which is the only thing the kind changes. */
const HEADINGS = {
  blank: { title: "dashboard.create.title", description: "dashboard.create.description" },
  example: { title: "dashboard.example.title", description: "dashboard.example.description" },
  import: { title: "import.title", description: "import.description" }
} as const

/**
 * The three things a Project is made of: what it is called, the token that lets
 * it speak as a bot, and the server it is tried on.
 *
 * Where it goes is not one of them, and is not asked. The user came to build a
 * bot, not to have an opinion about folders.
 *
 * The token is required, and the button says so by being dead until there is
 * one. A Project without a token opens onto a Run button that cannot work, and
 * the moment to find that out is not after building a Flow.
 *
 * What a bot token is and where it comes from is written under the field. It is
 * the one thing here that somebody who has never made a Discord bot cannot
 * guess, and a dialog that assumes they can is where they stop.
 *
 * The example is asked for here too, rather than appearing behind the user's
 * back, and so is a Project somebody sent. What each of them makes is a Project
 * like any other, so it is asked for like any other; only the words at the top
 * and the name already in the field say which one the user pressed.
 */
export function CreateProjectDialog({
  open,
  kind = "blank",
  suggestedName,
  onOpenChange,
  onCreate,
  problem
}: {
  open: boolean
  /**
   * Which Canvas the Project starts on, and which words to say about it.
   *
   * The name it puts in the field is what that field starts as, so a caller
   * offering more than one must key this component by the kind. Changing it on
   * a live instance changes the words at the top and leaves the other one's
   * name underneath them.
   */
  kind?: ProjectKind
  /**
   * The name the field starts with, when the Project already has one: an
   * import arrives called whatever its author called it, and that is the name
   * the user recognises the file by.
   */
  suggestedName?: string
  onOpenChange: (open: boolean) => void
  onCreate: (details: ProjectDetails) => void
  /** Why the last attempt did not make a Project, when it did not. */
  problem: string | undefined
}) {
  const [name, setName] = useState(
    suggestedName ?? (kind === "example" ? translate("dashboard.example.name") : "")
  )
  const [secret, setSecret] = useState("")
  const [testServerId, setTestServerId] = useState("")

  const ready = secret.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-project-dialog">
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (!ready) return
            onCreate({ name, secret, testServerId })
          }}
        >
          <DialogHeader>
            <DialogTitle>{translate(HEADINGS[kind].title)}</DialogTitle>
            <DialogDescription>{translate(HEADINGS[kind].description)}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="project-name">{translate("dashboard.create.name")}</Label>
            <Input
              id="project-name"
              data-testid="create-project-name"
              // The user is here to name their bot: the cursor is already in
              // the field they came to type in.
              autoFocus
              placeholder={translate("project.untitled")}
              value={name}
              onChange={event => setName(event.target.value)}
            />
          </div>

          <SecretField testId="create-project-token" value={secret} onChange={setSecret} />

          {/*
            The same field Project Options offers, given no Project: there is no
            stored token to ask Discord with yet, so it asks with the one being
            typed above, once the user presses the button to say it is there.
          */}
          <TestServerPicker
            testId="create-project-test-server"
            token={secret}
            value={testServerId}
            onChange={setTestServerId}
          />

          {problem === undefined ? null : (
            <p className="text-sm text-destructive" data-testid="create-project-problem">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              data-testid="create-project-cancel"
              onClick={() => onOpenChange(false)}
            >
              {translate("dashboard.create.cancel")}
            </Button>
            <Button type="submit" data-testid="create-project-confirm" disabled={!ready}>
              {translate("dashboard.create.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
