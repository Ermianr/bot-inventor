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
 * back. What it makes is a Project like any other, so it is asked for like any
 * other; only the words at the top and the name already in the field say which
 * of the two the user pressed.
 */
export function CreateProjectDialog({
  open,
  kind = "blank",
  onOpenChange,
  onCreate,
  problem
}: {
  open: boolean
  /** Which Canvas the Project starts on, and which words to say about it. */
  kind?: "blank" | "example"
  onOpenChange: (open: boolean) => void
  onCreate: (details: ProjectDetails) => void
  /** Why the last attempt did not make a Project, when it did not. */
  problem: string | undefined
}) {
  const [name, setName] = useState(kind === "example" ? translate("dashboard.example.name") : "")
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
            <DialogTitle>
              {translate(kind === "example" ? "dashboard.example.title" : "dashboard.create.title")}
            </DialogTitle>
            <DialogDescription>
              {translate(
                kind === "example"
                  ? "dashboard.example.description"
                  : "dashboard.create.description"
              )}
            </DialogDescription>
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
            The same field Project Options offers, given no Project: asking
            Discord for the servers a bot is in takes the token, and the token
            is still being typed. What is left is the id pasted by hand, and the
            list arrives in the editor once there is a Project to ask about.
          */}
          <TestServerPicker
            testId="create-project-test-server"
            value={testServerId}
            onChange={setTestServerId}
          />

          {problem === undefined ? null : (
            <p className="text-destructive text-sm" data-testid="create-project-problem">
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
