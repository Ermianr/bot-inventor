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
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreate,
  problem
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (details: ProjectDetails) => void
  /** Why the last attempt did not make a Project, when it did not. */
  problem: string | undefined
}) {
  const [name, setName] = useState("")
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
            <DialogTitle>{translate("dashboard.create.title")}</DialogTitle>
            <DialogDescription>{translate("dashboard.create.description")}</DialogDescription>
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

          <div className="grid gap-1.5">
            <Label htmlFor="project-token">{translate("dashboard.create.token")}</Label>
            <Input
              id="project-token"
              data-testid="create-project-token"
              type="password"
              autoComplete="off"
              placeholder={translate("run.token.placeholder")}
              value={secret}
              onChange={event => setSecret(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {translate("dashboard.create.token.help")}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="project-test-server">{translate("dashboard.create.testServer")}</Label>
            {/*
              An id typed by hand rather than a list chosen from: asking Discord
              for the servers a bot is in takes the token, and the token is
              still being typed. The list is offered in the editor, once there
              is a Project for it to belong to.
            */}
            <Input
              id="project-test-server"
              data-testid="create-project-test-server"
              inputMode="numeric"
              value={testServerId}
              onChange={event => setTestServerId(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">{translate("run.testServer.help")}</p>
          </div>

          {problem === undefined ? null : (
            <p className="text-destructive text-sm" data-testid="create-project-problem">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
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
