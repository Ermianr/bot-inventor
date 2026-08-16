import { Button } from "@bot-inventor/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@bot-inventor/ui/components/dialog"

import { APPLICATION_NAME, LICENCE, REPOSITORY, useApplication } from "@/about/application"
import { translate } from "@/i18n/messages"

/**
 * About: what this application is and which one of it the user has.
 *
 * It is the only place somebody who does not program can find that out, and it
 * is the first thing they will be asked when something goes wrong — so it reads
 * as a list of answers to give, rather than as a splash screen. Anything it
 * could not find out says so instead of being left blank: a missing line is a
 * question the user cannot tell they still have to answer.
 */
export function AboutDialog({
  open,
  onOpenChange,
  projectPath
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string | undefined
}) {
  // Reading this runs the Sidecar, so it is only asked for once the dialog is
  // on its way open.
  const { version, nodeVersion } = useApplication(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="about-dialog">
        <DialogHeader>
          <DialogTitle>{translate("about.title")}</DialogTitle>
          <DialogDescription>{translate("about.description")}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <Fact label={translate("about.version")} testId="about-version">
            {version === undefined ? translate("about.unknown") : `${APPLICATION_NAME} ${version}`}
          </Fact>

          <Fact label={translate("about.licence")} testId="about-licence">
            {LICENCE}
          </Fact>

          <Fact label={translate("about.node")} testId="about-node">
            {nodeVersion ?? translate("about.unknown")}
          </Fact>

          <Fact label={translate("about.project")} testId="about-project">
            {projectPath ?? translate("project.file.nowhere")}
          </Fact>

          <Fact label={translate("about.repository")} testId="about-repository">
            {/*
              Opened where the user's own browser can be pointed at it. The
              webview this runs in has nowhere to go back from, so a link that
              navigated in place would take the editor off the screen.
            */}
            <a
              href={REPOSITORY}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-3"
            >
              {REPOSITORY}
            </a>
          </Fact>
        </dl>

        <DialogFooter>
          <Button variant="outline" data-testid="about-close" onClick={() => onOpenChange(false)}>
            {translate("about.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One thing About has to say, and the words it is asked for in. */
function Fact({
  label,
  testId,
  children
}: {
  label: string
  testId: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      {/* Long paths and the repository's address are the two that overflow. */}
      <dd className="break-all" data-testid={testId}>
        {children}
      </dd>
    </>
  )
}
