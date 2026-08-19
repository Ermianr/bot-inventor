// @vitest-environment jsdom

import { SESSION_MESSAGE_PREFIX } from "@bot-inventor/compiler"
import type { Project } from "@bot-inventor/schema"
import { embedReplyProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionExitEvent, SessionId, SessionOutputEvent } from "@/session/events"
import type { SessionGateway } from "@/session/session-gateway"
import { RELOAD_DELAY, useSession } from "@/session/use-session"

/**
 * A Session driven the way the panel and the Canvas drive it, with the one
 * thing only a desktop shell can do — actually running a bot — done by the test
 * instead.
 *
 * Hot reload is most of what is checked here, because it is the part with a
 * race in it: a reload kills a bot and starts another, and everything the dying
 * one still has to say arrives after the new one has already begun.
 */

type Started = { projectId: string; entry: string; session: SessionId }

function fakeGateway() {
  const started: Started[] = []
  let stops = 0
  let output: ((event: SessionOutputEvent) => void) | undefined
  let exit: ((event: SessionExitEvent) => void) | undefined
  /** Set to make the next start fail the way a refused keychain would. */
  let refuse: unknown

  const gateway: SessionGateway = {
    start: async request => {
      if (refuse !== undefined) {
        const refusal = refuse
        refuse = undefined
        throw refusal
      }
      started.push(request)
    },
    stop: async () => {
      stops += 1
    },
    onOutput: forward => {
      output = forward
      return () => {
        output = undefined
      }
    },
    onExit: forward => {
      exit = forward
      return () => {
        exit = undefined
      }
    }
  }

  return {
    gateway,
    started,
    stops: () => stops,
    /** The number of the bot the editor started last. */
    latest: () => started.at(-1)?.session ?? 0,
    refuseNextStart: (refusal: unknown) => {
      refuse = refusal
    },
    /** One line from a bot, as the Tauri side would deliver it. */
    say: (session: SessionId, line: string) =>
      act(() => output?.({ session, stream: "stdout", line })),
    /** One message the Session sent on purpose. */
    send: (session: SessionId, message: unknown) =>
      act(() =>
        output?.({
          session,
          stream: "stdout",
          line: SESSION_MESSAGE_PREFIX + JSON.stringify(message)
        })
      ),
    ended: (session: SessionId) => act(() => exit?.({ session, code: 0 }))
  }
}

/** The same Project with one Node's field edited, which is what a user does. */
function withGreeting(project: Project, greeting: string): Project {
  const [flow] = project.flows
  if (flow === undefined) throw new Error("the fixture has no Flow to edit")

  const [first, ...rest] = flow.nodes
  if (first === undefined) throw new Error("the fixture has no Node to edit")

  return {
    ...project,
    flows: [
      {
        ...flow,
        nodes: [{ ...first, fields: { ...first.fields, description: greeting } }, ...rest]
      },
      ...project.flows.slice(1)
    ]
  }
}

/** What starting a bot takes. The token is not part of it: the shell reads it. */
const RUNNING = { testServerId: "1" }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Runs a bot and waits for it to report that it connected. */
async function run(shell: ReturnType<typeof fakeGateway>, project: Project) {
  const session = renderHook(
    ({ current }: { current: Project }) => useSession(current, shell.gateway),
    { initialProps: { current: project } }
  )

  await act(() => session.result.current.start(RUNNING))
  shell.send(shell.latest(), { kind: "status", status: "ready" })
  expect(session.result.current.status).toBe("ready")

  return session
}

describe("running a bot", () => {
  it("reports the bot as ready once it says it connected", async () => {
    const shell = fakeGateway()
    const session = await run(shell, helloProject())

    expect(shell.started).toHaveLength(1)
    expect(session.result.current.problem).toBeUndefined()
  })

  it("says why a bot that could not be started did not start", async () => {
    const shell = fakeGateway()
    shell.refuseNextStart({ kind: "missing-secret" })

    const session = renderHook(() => useSession(helloProject(), shell.gateway))
    await act(() => session.result.current.start(RUNNING))

    expect(session.result.current.status).toBe("failed")
    expect(session.result.current.problem).toContain("token")
  })

  it("ignores what a bot the editor is no longer running has to say", async () => {
    const shell = fakeGateway()
    const session = await run(shell, helloProject())
    const abandoned = shell.latest() + 1

    shell.say(abandoned, "a line from somebody else's bot")
    shell.ended(abandoned)

    expect(session.result.current.status).toBe("ready")
    expect(session.result.current.entries).toHaveLength(0)
  })
})

describe("hot reload", () => {
  it("restarts the bot when a field is edited while it runs", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ current: withGreeting(project, "a new description") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY)
    })

    await waitFor(() => expect(shell.started).toHaveLength(2))
    expect(shell.started[1]?.entry).toContain("a new description")
    expect(shell.started[1]?.session).not.toBe(shell.started[0]?.session)
  })

  it("keeps the panel through a reload, so the user does not lose their place", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)
    shell.say(shell.latest(), "something the bot said before the edit")

    session.rerender({ current: withGreeting(project, "edited") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY)
    })
    await waitFor(() => expect(shell.started).toHaveLength(2))

    expect(session.result.current.entries.map(entry => entry.text)).toContain(
      "something the bot said before the edit"
    )
  })

  it("starts one bot for a burst of edits rather than one per keystroke", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    for (const greeting of ["a", "ab", "abc", "abcd"]) {
      session.rerender({ current: withGreeting(project, greeting) })
      await act(async () => {
        vi.advanceTimersByTime(RELOAD_DELAY / 3)
      })
    }
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY)
    })

    await waitFor(() => expect(shell.started).toHaveLength(2))
    expect(shell.started[1]?.entry).toContain("abcd")
  })

  it("does not restart for an edit the bot cannot tell apart", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ current: { ...project, name: "A different name" } })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY * 2)
    })

    expect(shell.started).toHaveLength(1)
  })

  it("does not restart a bot that is not running", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = renderHook(
      ({ current }: { current: Project }) => useSession(current, shell.gateway),
      { initialProps: { current: project } }
    )

    session.rerender({ current: withGreeting(project, "edited while stopped") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY * 2)
    })

    expect(shell.started).toHaveLength(0)
  })

  it("stops reloading once the user stops the bot", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    await act(() => session.result.current.stop())
    session.rerender({ current: withGreeting(project, "edited after Stop") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY * 2)
    })

    expect(shell.started).toHaveLength(1)
    expect(session.result.current.status).toBe("stopped")
  })

  it("drops the trace of the bot that has been replaced", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    const [flow] = project.flows
    const [node] = flow?.nodes ?? []
    shell.send(shell.latest(), {
      kind: "trace",
      event: { kind: "node-entered", run: 1, flow: flow?.id, node: node?.id }
    })
    expect(session.result.current.trace).toBeDefined()

    session.rerender({ current: withGreeting(project, "edited") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY)
    })

    await waitFor(() => expect(shell.started).toHaveLength(2))
    expect(session.result.current.trace).toBeUndefined()
  })

  it("does not read the death of the old bot as the new one stopping", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)
    const replaced = shell.latest()

    session.rerender({ current: withGreeting(project, "edited") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY)
    })
    await waitFor(() => expect(shell.started).toHaveLength(2))

    // The bot that was killed reports its own end after the new one is up.
    shell.ended(replaced)
    shell.send(shell.latest(), { kind: "status", status: "ready" })

    expect(session.result.current.status).toBe("ready")
  })
})

/**
 * A Node the editor already knows Discord would refuse never becomes a running
 * bot. The Embed Node is the first that can say so, and the reason the user
 * reads here is the same one drawn on the Node.
 */
describe("a Run a Node refuses", () => {
  it("does not start a bot whose Embed has nothing in it", async () => {
    const shell = fakeGateway()
    const project = embedReplyProject()
    const node = requireEmbedNode(project)
    node.fields = { ...node.fields, title: [], description: [] }

    const session = renderHook(() => useSession(project, shell.gateway))
    await act(() => session.result.current.start(RUNNING))

    expect(shell.started).toEqual([])
    expect(session.result.current.status).toBe("failed")
    expect(session.result.current.problem).toContain("nothing in it")
  })

  it("starts the bot once the Embed says something", async () => {
    const shell = fakeGateway()
    const session = await run(shell, embedReplyProject())

    expect(shell.started).toHaveLength(1)
    expect(session.result.current.problem).toBeUndefined()
  })
})

/** The Embed Node of the fixture, for a test that empties it. */
function requireEmbedNode(project: Project) {
  const node = project.flows
    .flatMap(flow => flow.nodes)
    .find(candidate => candidate.type === "discord.embed.build")
  if (node === undefined) throw new Error("the fixture has no Embed Node")
  return node
}

describe("an edit that does not compile", () => {
  it("says so and leaves the running bot alone", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ current: withoutTheCatalogue(project) })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY * 2)
    })

    expect(shell.started).toHaveLength(1)
    expect(shell.stops()).toBe(0)
    expect(session.result.current.status).toBe("ready")
    expect(session.result.current.problem).toBeDefined()
  })

  it("reloads again once the edit compiles", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ current: withoutTheCatalogue(project) })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY * 2)
    })
    expect(session.result.current.problem).toBeDefined()

    session.rerender({ current: withGreeting(project, "put right again") })
    await act(async () => {
      vi.advanceTimersByTime(RELOAD_DELAY)
    })

    await waitFor(() => expect(shell.started).toHaveLength(2))
    expect(session.result.current.problem).toBeUndefined()
  })
})

/** A Project with a Node no catalogue knows, which is what the Compiler refuses. */
function withoutTheCatalogue(project: Project): Project {
  const [flow] = project.flows
  if (flow === undefined) throw new Error("the fixture has no Flow to break")

  const [first, ...rest] = flow.nodes
  if (first === undefined) throw new Error("the fixture has no Node to break")

  return {
    ...project,
    flows: [
      { ...flow, nodes: [{ ...first, type: "nothing.at.all" }, ...rest] },
      ...project.flows.slice(1)
    ]
  }
}
