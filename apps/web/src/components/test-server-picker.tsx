import { Button } from "@bot-inventor/ui/components/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from "@bot-inventor/ui/components/combobox"
import { Input } from "@bot-inventor/ui/components/input"
import { Label } from "@bot-inventor/ui/components/label"
import { invoke } from "@tauri-apps/api/core"
import { useCallback, useEffect, useRef, useState } from "react"
import { translate } from "@/i18n/messages"
import { describeRefusal } from "@/session/refusal"

/**
 * Choosing the Test Server by name.
 *
 * The list comes from Discord, through the Tauri side, because asking takes the
 * token. A bot in a great many servers is why this is a Combobox rather than a
 * plain dropdown, and why an id can still be pasted by hand: the list is
 * capped, and the one server the user wants might be past the cap.
 *
 * A Project that does not exist yet has no stored token, so the one being typed
 * in the form beside this is what it asks with, and the user presses Look for
 * servers when they have pasted it. Nothing looks on its own there: a token
 * half-typed would only produce a refusal the user has to read past.
 */

/** One server, as the Tauri side reports it. */
type TestServer = { id: string; name: string }

/** Matches the cap in `src-tauri/src/test_servers.rs`. */
const LIMIT = 1000

export type TestServerPickerProps = {
  /** The Project whose servers are listed, or nothing when there is no Project. */
  projectId?: string
  /**
   * The token to ask Discord with when there is no Project to read one for:
   * what the form beside this has been typed into so far. A stored token is
   * never sent here — the Tauri side reads that one itself.
   */
  token?: string
  /**
   * What this picker is called on the page: it names the fields for their
   * labels and for a test, whose words are translated and cannot be searched
   * for. Two pickers can be on the page at once — Project Options opens over
   * the Run Panel — and a label pointing at the other one's field is a label
   * that focuses the wrong thing.
   */
  testId: string
  /** The id currently chosen, which is what a Session registers to. */
  value: string
  onChange(testServerId: string): void
}

export function TestServerPicker({
  projectId,
  token,
  testId,
  value,
  onChange
}: TestServerPickerProps) {
  const [servers, setServers] = useState<readonly TestServer[]>([])
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  /** Whether Discord has been asked at all, which is what a list means anything after. */
  const [asked, setAsked] = useState(false)
  /** Which question is the one still worth an answer. */
  const latestAsk = useRef(0)

  const typed = token?.trim() ?? ""
  /** Something to ask Discord with: a Project to read a token for, or one typed. */
  const askable = projectId !== undefined || typed.length > 0

  /**
   * The token is passed in rather than read from above, so that looking again
   * is what the button does and not what every keystroke of the token does.
   */
  const look = useCallback(
    async (token: string) => {
      if (projectId === undefined && token.length === 0) return
      // Only the latest question is worth an answer: a slow reply to a question
      // the user has already asked again would otherwise clear the newer one's
      // spinner and overwrite its list.
      const asking = ++latestAsk.current
      setLoading(true)
      setProblem(undefined)
      setAsked(true)
      try {
        const found = await invoke<TestServer[]>("list_test_servers", { projectId, token })
        if (asking !== latestAsk.current) return
        setServers(found)
      } catch (error) {
        if (asking !== latestAsk.current) return
        // Not having a token yet is the ordinary state of a new Project, not
        // something to shout about: the token field above says what to do.
        setServers([])
        setProblem(describeRefusal(error))
      } finally {
        if (asking === latestAsk.current) setLoading(false)
      }
    },
    [projectId]
  )

  // A Project already has its token, so its servers are there to be picked from
  // the moment the dialog opens. A Project being created has not been typed one
  // yet, and waits for the button.
  useEffect(() => {
    if (projectId === undefined) return
    void look("")
  }, [look, projectId])

  const chosen = servers.find(server => server.id === value) ?? null
  const capped = servers.length >= LIMIT
  const listing = projectId !== undefined || asked

  /** Beside whichever field is on top, because that is the one it fills. */
  const lookButton = (
    <Button
      variant="outline"
      type="button"
      data-testid={`${testId}-look`}
      onClick={() => void look(typed)}
      disabled={loading || !askable}
    >
      {translate("run.testServer.look")}
    </Button>
  )

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={listing ? `${testId}-search` : testId}>
        {translate("run.testServer.label")}
      </Label>

      {!listing ? null : (
        <div className="flex items-center gap-2">
          {/* The Combobox renders no element of its own, so the width lives here. */}
          <div className="min-w-0 flex-1">
            <Combobox
              items={servers as TestServer[]}
              value={chosen}
              onValueChange={(server: TestServer | null) => onChange(server?.id ?? "")}
              itemToStringLabel={(server: TestServer) => server.name}
              // Searching by id as well as by name, because the id is what someone
              // arrives with when they copied it out of Discord.
              filter={(server: TestServer, query: string) =>
                server.name.toLowerCase().includes(query.trim().toLowerCase()) ||
                server.id.includes(query.trim())
              }
              disabled={loading || servers.length === 0}
            >
              <ComboboxInput
                id={`${testId}-search`}
                placeholder={translate(
                  loading ? "run.testServer.loading" : "run.testServer.search"
                )}
              />
              <ComboboxContent>
                <ComboboxEmpty>{translate("run.testServer.noMatch")}</ComboboxEmpty>
                <ComboboxList>
                  <ComboboxCollection>
                    {(server: TestServer) => (
                      <ComboboxItem key={server.id} value={server}>
                        {server.name}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          {lookButton}
        </div>
      )}

      {/*
        The way out of everything the list cannot do: a bot in no server yet, a
        token Discord would not answer for, a server past the cap, or a Project
        that does not exist to ask about.
      */}
      {listing && (loading || (servers.length > 0 && !capped)) ? null : (
        <>
          {!listing ? null : (
            <p className="text-muted-foreground text-xs">
              {problem ??
                translate(capped ? "run.testServer.capped" : "run.testServer.none", {
                  count: String(LIMIT)
                })}
            </p>
          )}
          {/* The label above is this field's own until there is a list to prefer. */}
          {!listing ? null : (
            <Label htmlFor={testId} className="text-muted-foreground">
              {translate("run.testServer.manual")}
            </Label>
          )}
          <div className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              id={testId}
              data-testid={testId}
              inputMode="numeric"
              value={value}
              onChange={event => onChange(event.target.value)}
            />
            {/* Only once on the page: the list above already carries it. */}
            {listing ? null : lookButton}
          </div>
        </>
      )}

      <p className="text-muted-foreground text-xs">{translate("run.testServer.help")}</p>
    </div>
  )
}
