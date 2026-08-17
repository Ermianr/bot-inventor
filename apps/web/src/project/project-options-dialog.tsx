import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"
import { useEffect, useState } from "react"

import { SecretField } from "@/components/secret-field"
import { TestServerPicker } from "@/components/test-server-picker"
import { translate } from "@/i18n/messages"
import type { ProjectStore } from "@/project/project-store"
import type { TestServer } from "@/project/use-test-server"
import { describeRefusal } from "@/session/refusal"

/**
 * How this Project talks to Discord, once it exists: the token it signs in with
 * and the server it is tried on.
 *
 * Those two and nothing else. The name is not here — a Project is renamed on
 * its Dashboard card, beside every other one — and neither is anything to do
 * with files, which the application owns (ADR 0009).
 *
 * The token field starts empty every time and is never filled from storage: a
 * Secret is not put on screen for whoever is walking past, and nothing can hand
 * one back anyway. Whether there is one is the whole of what is said about it,
 * which is what tells the user whether typing here replaces something.
 *
 * The Test Server is written the moment it is picked, the way it is everywhere
 * else, so the button below is about the token alone.
 */
export function ProjectOptionsDialog({
  open,
  onOpenChange,
  store,
  projectId,
  testServer
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  store: ProjectStore
  projectId: string
  testServer: TestServer
}) {
  const [secret, setSecret] = useState("")
  const [stored, setStored] = useState(false)
  /** Why the token was not stored, when it was not. */
  const [problem, setProblem] = useState<string | undefined>(undefined)

  useEffect(() => {
    let current = true
    store
      .hasSecret(projectId)
      .then(has => {
        if (current) setStored(has)
      })
      .catch(() => {
        if (current) setStored(false)
      })
    return () => {
      current = false
    }
  }, [store, projectId])

  /**
   * A keychain that refuses the token says so here. Letting the call reject on
   * its own leaves a button that does nothing and explains nothing — and
   * outside the desktop shell, where there is no keychain to write to, that is
   * every press of it.
   *
   * An empty field is not a token being cleared: it is somebody who came to
   * change the server and left the token where it was.
   */
  const save = async () => {
    setProblem(undefined)
    if (secret.trim().length === 0) {
      onOpenChange(false)
      return
    }

    try {
      await store.storeSecret(projectId, secret)
      setStored(true)
      setSecret("")
      onOpenChange(false)
    } catch (error) {
      setProblem(describeRefusal(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="project-options-dialog">
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <DialogHeader>
            <DialogTitle>{translate("project.options.title")}</DialogTitle>
            <DialogDescription>{translate("project.options.description")}</DialogDescription>
          </DialogHeader>

          <SecretField
            id="project-options-token"
            testId="project-options-token"
            value={secret}
            onChange={setSecret}
            stored={stored}
          />

          <TestServerPicker
            projectId={projectId}
            testId="project-options-test-server"
            value={testServer.testServerId}
            onChange={testServer.choose}
          />

          {problem === undefined ? null : (
            <p className="text-destructive text-sm" data-testid="project-options-problem">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              {translate("project.options.cancel")}
            </Button>
            <Button type="submit" data-testid="project-options-save">
              {translate("project.options.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
