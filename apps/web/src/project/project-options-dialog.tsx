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
 * else. So there is nothing here to cancel and nothing to save but the token:
 * one button, which stores what was typed and closes. A Cancel beside it would
 * promise to put back a server that was already changed.
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
  /** Whether a token is stored, or nothing while the keychain has not said. */
  const [stored, setStored] = useState<boolean | undefined>(undefined)
  /** Why the keychain could not be read or written, when it could not. */
  const [problem, setProblem] = useState<string | undefined>(undefined)

  /**
   * A keychain that will not answer says so, rather than being read as a
   * Project with no token: that would tell somebody whose token is perfectly
   * safe that it is gone, and invite them to paste it again into a keychain
   * that is not going to take it either.
   */
  useEffect(() => {
    let current = true
    store
      .hasSecret(projectId)
      .then(has => {
        if (current) setStored(has)
      })
      .catch((error: unknown) => {
        if (!current) return
        setStored(undefined)
        setProblem(describeRefusal(error))
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
            <p className="text-sm text-destructive" data-testid="project-options-problem">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" data-testid="project-options-done">
              {translate("project.options.done")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
