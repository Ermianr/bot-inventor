import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"

import { SESSION_MESSAGE_PREFIX } from "@bot-inventor/compiler"
import type { Project } from "@bot-inventor/schema"
import { embedReplyProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { SessionExitEvent, SessionId, SessionOutputEvent } from "@/session/events"
import type { SessionGateway } from "@/session/session-gateway"
import { OUTDATED_DELAY, useSession } from "@/session/use-session"

/**
 * A Session driven the way the panel and the Canvas drive it, with the one
 * thing only a desktop shell can do — actually running a bot — done by the test
 * instead.
 *
 * Reloading is most of what is checked here, because it is the part with a race
 * in it: a Reload kills a bot and starts another, and everything the dying one
 * still has to say arrives after the new one has already begun. Nothing here
 * ever starts a bot on its own — that is what this whole block is about.
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

/**
 * How an entry point says which server its commands are registered to. It is
 * read out of the generated code because that is the whole point: the Test
 * Server has to be visible there for a change of server to be a change of bot.
 */
function onTestServer(testServerId: string) {
  return `guildId: ${JSON.stringify(testServerId)}`
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

/** The Test Server a Project is tried on, unless a test picks another one. */
const TEST_SERVER = "1"

beforeEach(() => {
  // No `shouldAdvanceTime`: Bun's fake timers leave the microtask queue alone,
  // so an awaited promise still settles without the clock being nudged, and
  // `settle()` is what moves the clock.
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Runs a bot and waits for it to report that it connected. */
async function run(shell: ReturnType<typeof fakeGateway>, project: Project) {
  const session = renderHook(
    ({ current, testServerId }: { current: Project; testServerId: string }) =>
      useSession(current, shell.gateway, testServerId),
    { initialProps: { current: project, testServerId: TEST_SERVER } }
  )

  await act(() => session.result.current.start())
  shell.send(shell.latest(), { kind: "status", status: "ready" })
  expect(session.result.current.status).toBe("ready")
  // The bot is tried on the Test Server the Project is set to, from the first
  // Run onwards and not only from the reload that follows a change of server.
  expect(shell.started[0]?.entry).toContain(onTestServer(TEST_SERVER))

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

    const session = renderHook(() => useSession(helloProject(), shell.gateway, TEST_SERVER))
    await act(() => session.result.current.start())

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

/** Lets the editor notice that the Project and the running bot have parted. */
async function settle(times = 1) {
  await act(async () => {
    vi.advanceTimersByTime(OUTDATED_DELAY * times)
  })
}

/**
 * An Outdated Session: a bot that is alive and answering, on code the user has
 * moved on from. Nothing about it starts a bot — that only happens when the
 * user asks for a Reload.
 */
describe("an Outdated Session", () => {
  it("marks the Session outdated when a field is edited, without starting anything", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({
      testServerId: TEST_SERVER,
      current: withGreeting(project, "a new description")
    })
    await settle()

    await waitFor(() => expect(session.result.current.outdated).toBe(true))
    expect(shell.started).toHaveLength(1)
    // Outdated is beside the status and never instead of it: the bot is still
    // running, and saying only one of the two would be a lie.
    expect(session.result.current.status).toBe("ready")
  })

  /**
   * What is compared is the generated entry point and not the Project, which is
   * what makes dragging a Node across the Canvas free.
   */
  it("leaves the Session current after an edit the bot cannot tell apart", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({
      testServerId: TEST_SERVER,
      current: { ...project, name: "A different name" }
    })
    await settle(2)

    expect(session.result.current.outdated).toBe(false)
    expect(shell.started).toHaveLength(1)
  })

  it("is over once the edit is undone", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ testServerId: TEST_SERVER, current: withGreeting(project, "edited") })
    await settle()
    await waitFor(() => expect(session.result.current.outdated).toBe(true))

    session.rerender({ testServerId: TEST_SERVER, current: project })
    await settle()

    await waitFor(() => expect(session.result.current.outdated).toBe(false))
    expect(shell.started).toHaveLength(1)
  })

  it("notices the Test Server the user has just picked", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ current: project, testServerId: "999" })
    await settle()

    await waitFor(() => expect(session.result.current.outdated).toBe(true))
  })

  it("says nothing about a bot that is not running", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = renderHook(
      ({ current, testServerId }: { current: Project; testServerId: string }) =>
        useSession(current, shell.gateway, testServerId),
      { initialProps: { current: project, testServerId: TEST_SERVER } }
    )

    session.rerender({
      testServerId: TEST_SERVER,
      current: withGreeting(project, "edited while stopped")
    })
    await settle(2)

    expect(session.result.current.outdated).toBe(false)
    expect(shell.started).toHaveLength(0)
  })

  it("ends when the user stops the bot", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ testServerId: TEST_SERVER, current: withGreeting(project, "edited") })
    await settle()
    await waitFor(() => expect(session.result.current.outdated).toBe(true))

    await act(() => session.result.current.stop())

    expect(session.result.current.outdated).toBe(false)
    expect(session.result.current.status).toBe("stopped")
    expect(shell.started).toHaveLength(1)
  })
})

describe("a Reload", () => {
  it("puts one bot built from the current Project in place of the one running", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({
      testServerId: TEST_SERVER,
      current: withGreeting(project, "a new description")
    })
    await settle()
    await act(() => session.result.current.reload())

    expect(shell.started).toHaveLength(2)
    expect(shell.started[1]?.entry).toContain("a new description")
    expect(shell.started[1]?.session).not.toBe(shell.started[0]?.session)
    expect(session.result.current.outdated).toBe(false)
  })

  it("builds the bot around the Test Server the user has just picked", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ current: project, testServerId: "999" })
    await settle()
    await act(() => session.result.current.reload())

    expect(shell.started.at(-1)?.entry).toContain(onTestServer("999"))
    expect(shell.started.at(-1)?.entry).not.toContain(onTestServer(TEST_SERVER))
  })

  it("keeps the Console through a Reload, so the user does not lose their place", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)
    shell.say(shell.latest(), "something the bot said before the edit")

    session.rerender({ testServerId: TEST_SERVER, current: withGreeting(project, "edited") })
    await settle()
    await act(() => session.result.current.reload())

    expect(session.result.current.entries.map(entry => entry.text)).toContain(
      "something the bot said before the edit"
    )
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

    session.rerender({ testServerId: TEST_SERVER, current: withGreeting(project, "edited") })
    await settle()
    await act(() => session.result.current.reload())

    expect(session.result.current.trace).toBeUndefined()
  })

  it("does nothing when there is no bot to replace", async () => {
    const shell = fakeGateway()
    const session = renderHook(() => useSession(helloProject(), shell.gateway, TEST_SERVER))

    await act(() => session.result.current.reload())

    expect(shell.started).toHaveLength(0)
    expect(session.result.current.status).toBe("stopped")
  })

  it("does not read the death of the old bot as the new one stopping", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)
    const replaced = shell.latest()

    session.rerender({ testServerId: TEST_SERVER, current: withGreeting(project, "edited") })
    await settle()
    await act(() => session.result.current.reload())

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

    const session = renderHook(() => useSession(project, shell.gateway, TEST_SERVER))
    await act(() => session.result.current.start())

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

    session.rerender({ testServerId: TEST_SERVER, current: withoutTheCatalogue(project) })
    await settle(2)

    expect(shell.started).toHaveLength(1)
    expect(shell.stops()).toBe(0)
    expect(session.result.current.status).toBe("ready")
    expect(session.result.current.problem).toBeDefined()
    // The bot is behind the Canvas and the editor says so; what the problem
    // beside it takes away is the Reload, not the fact of being behind.
    expect(session.result.current.outdated).toBe(true)
  })

  it("refuses a Reload asked for anyway", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ testServerId: TEST_SERVER, current: withoutTheCatalogue(project) })
    await settle(2)
    await act(() => session.result.current.reload())

    expect(shell.started).toHaveLength(1)
    expect(session.result.current.status).toBe("ready")
  })

  it("keeps the Session outdated while the edit is broken", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ testServerId: TEST_SERVER, current: withoutTheCatalogue(project) })
    await settle(2)

    await waitFor(() => expect(session.result.current.outdated).toBe(true))
    expect(session.result.current.status).toBe("ready")
  })

  it("clears the warning and offers a Reload once the edit compiles", async () => {
    const shell = fakeGateway()
    const project = helloProject()
    const session = await run(shell, project)

    session.rerender({ testServerId: TEST_SERVER, current: withoutTheCatalogue(project) })
    await settle(2)
    expect(session.result.current.problem).toBeDefined()

    session.rerender({
      testServerId: TEST_SERVER,
      current: withGreeting(project, "put right again")
    })
    await settle()

    await waitFor(() => expect(session.result.current.outdated).toBe(true))
    expect(session.result.current.problem).toBeUndefined()
    expect(shell.started).toHaveLength(1)
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
