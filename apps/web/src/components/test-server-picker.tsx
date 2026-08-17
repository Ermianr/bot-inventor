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
import { useCallback, useEffect, useState } from "react"
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
 * A Project that does not exist yet has nothing to ask Discord with — its token
 * is still being typed in the form beside this — so it is given no id, and what
 * is left is the pasted id alone. That is the same field either way rather than
 * a second one that happens to look like it.
 */

/** One server, as the Tauri side reports it. */
type TestServer = { id: string; name: string }

/** Matches the cap in `src-tauri/src/test_servers.rs`. */
const LIMIT = 1000

export type TestServerPickerProps = {
  /** The Project whose servers are listed, or nothing when there is no Project. */
  projectId?: string
  /** How the pasted-id field is found by a test, since its words are translated. */
  testId: string
  /** The id currently chosen, which is what a Session registers to. */
  value: string
  onChange(testServerId: string): void
}

export function TestServerPicker({ projectId, testId, value, onChange }: TestServerPickerProps) {
  const [servers, setServers] = useState<readonly TestServer[]>([])
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const look = useCallback(async () => {
    if (projectId === undefined) return
    setLoading(true)
    setProblem(undefined)
    try {
      setServers(await invoke<TestServer[]>("list_test_servers", { projectId }))
    } catch (error) {
      // Not having a token yet is the ordinary state of a new Project, not
      // something to shout about: the token field above says what to do.
      setServers([])
      setProblem(describeRefusal(error))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void look()
  }, [look])

  const chosen = servers.find(server => server.id === value) ?? null
  const capped = servers.length >= LIMIT
  const listing = projectId !== undefined

  return (
    <div className="grid gap-1.5">
      {!listing ? null : (
        <>
          <div className="flex items-center justify-between">
            <Label htmlFor="test-server">{translate("run.testServer.label")}</Label>
            <Button variant="ghost" size="xs" onClick={look} disabled={loading}>
              {translate("run.testServer.reload")}
            </Button>
          </div>

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
              id="test-server"
              placeholder={translate(loading ? "run.testServer.loading" : "run.testServer.search")}
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
        </>
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
          <Label htmlFor="test-server-id" className={listing ? "text-muted-foreground" : undefined}>
            {translate(listing ? "run.testServer.manual" : "run.testServer.label")}
          </Label>
          <Input
            id="test-server-id"
            data-testid={testId}
            inputMode="numeric"
            value={value}
            onChange={event => onChange(event.target.value)}
          />
        </>
      )}

      <p className="text-muted-foreground text-xs">{translate("run.testServer.help")}</p>
    </div>
  )
}
