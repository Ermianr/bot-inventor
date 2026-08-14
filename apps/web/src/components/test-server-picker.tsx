import { Button } from "@bot-inventor/ui/components/button"
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
 * token. A bot in a great many servers is why there is a search box rather than
 * a plain dropdown, and why the id can still be pasted by hand: the list is
 * capped, and the one server the user wants might be past the cap.
 */

/** One server, as the Tauri side reports it. */
type TestServer = { id: string; name: string }

/** Matches the cap in `src-tauri/src/test_servers.rs`. */
const LIMIT = 1000

export type TestServerPickerProps = {
  projectId: string
  /** The id currently chosen, which is what a Session registers to. */
  value: string
  onChange(testServerId: string): void
}

export function TestServerPicker({ projectId, value, onChange }: TestServerPickerProps) {
  const [servers, setServers] = useState<readonly TestServer[]>([])
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState("")

  const look = useCallback(async () => {
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

  const wanted = search.trim().toLowerCase()
  const matching =
    wanted.length === 0
      ? servers
      : servers.filter(
          server => server.name.toLowerCase().includes(wanted) || server.id.includes(wanted)
        )

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor="test-server-search">{translate("run.testServer.label")}</Label>
        <Button variant="ghost" size="xs" onClick={look} disabled={loading}>
          {translate("run.testServer.reload")}
        </Button>
      </div>

      <Input
        id="test-server-search"
        placeholder={translate("run.testServer.search")}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />

      <div className="max-h-40 overflow-y-auto ring-1 ring-foreground/10">
        {loading ? (
          <p className="p-2 text-muted-foreground text-xs">{translate("run.testServer.loading")}</p>
        ) : matching.length === 0 ? (
          <p className="p-2 text-muted-foreground text-xs">
            {translate(servers.length === 0 ? "run.testServer.none" : "run.testServer.noMatch")}
          </p>
        ) : (
          <ul>
            {matching.map(server => (
              <li key={server.id}>
                <button
                  type="button"
                  onClick={() => onChange(server.id)}
                  aria-current={server.id === value}
                  className="w-full px-2 py-1 text-left text-xs hover:bg-muted aria-[current=true]:bg-muted aria-[current=true]:font-medium"
                >
                  {server.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {servers.length >= LIMIT ? (
        <p className="text-muted-foreground text-xs">
          {translate("run.testServer.capped", { count: String(LIMIT) })}
        </p>
      ) : null}

      {problem === undefined ? null : <p className="text-destructive text-xs">{problem}</p>}

      <Label htmlFor="test-server-id" className="text-muted-foreground">
        {translate("run.testServer.manual")}
      </Label>
      <Input
        id="test-server-id"
        inputMode="numeric"
        value={value}
        onChange={event => onChange(event.target.value)}
      />

      <p className="text-muted-foreground text-xs">{translate("run.testServer.help")}</p>
    </div>
  )
}
