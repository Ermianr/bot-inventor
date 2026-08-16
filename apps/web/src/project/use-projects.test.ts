// @vitest-environment jsdom

import { emptyProject, greetingProject, helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { translate } from "@/i18n/messages"
import { fakeProjectStore } from "@/project/fake-project-store"
import { useProjects } from "@/project/use-projects"

/**
 * The Dashboard's own decisions, driven the way the screen drives them and with
 * the store in memory. Nothing here knows where a Project physically lands —
 * that is precisely the knowledge the port exists to hide.
 */

/** The hook, once it has finished reading the store. */
async function dashboard(store = fakeProjectStore()) {
  const { result } = renderHook(() => useProjects(store))
  await waitFor(() => {
    expect(result.current.projects).toBeDefined()
  })
  return { store, result }
}

describe("the Dashboard", () => {
  it("lists what the store holds", async () => {
    const { result } = await dashboard(fakeProjectStore([helloProject(), greetingProject()]))

    expect(result.current.projects?.map(project => project.name)).toEqual(
      expect.arrayContaining([helloProject().name, greetingProject().name])
    )
  })

  it("shows nothing at all when the store holds nothing", async () => {
    const { result } = await dashboard()

    expect(result.current.projects).toEqual([])
  })

  /**
   * The one the user was working on yesterday is the one they came back for, so
   * it is the one nearest the top.
   */
  it("puts the most recently changed Project first", async () => {
    const store = fakeProjectStore([helloProject(), greetingProject()])
    await store.write({ ...helloProject(), name: "Hello again" })

    const { result } = await dashboard(store)

    expect(result.current.projects?.[0]?.name).toBe("Hello again")
  })

  /**
   * A Project nothing can read is still the user's. Leaving it off the list
   * would read as work that is gone; showing it is what gets them to the
   * explanation, which the editor gives when they open it.
   */
  it("still shows a Project whose document cannot be read", async () => {
    const store = fakeProjectStore()
    store.contents.set("project-damaged", {
      document: "half a fi",
      testServerId: "",
      secret: ""
    })

    const { result } = await dashboard(store)

    expect(result.current.projects?.map(project => project.id)).toEqual(["project-damaged"])
  })

  it("says so when the store could not be listed", async () => {
    const store = fakeProjectStore()
    store.breaks.list = "the disk is asleep"

    const { result } = await dashboard(store)

    expect(result.current.problem).toContain("the disk is asleep")
  })
})

describe("creating a Project", () => {
  it("stores the Project, its token and its Test Server, and says which one it made", async () => {
    const { store, result } = await dashboard()

    let created: string | undefined
    await act(async () => {
      created = await result.current.create({
        name: "Moderation bot",
        secret: "a-token",
        testServerId: "123"
      })
    })

    expect(created).toBeDefined()
    const stored = store.contents.get(created ?? "")
    expect(stored?.secret).toBe("a-token")
    expect(stored?.testServerId).toBe("123")
    expect(stored?.document).toContain("Moderation bot")
    expect(result.current.projects?.map(project => project.name)).toEqual(["Moderation bot"])
  })

  /**
   * A Project without a token opens onto a Run button that cannot work, and the
   * moment to find that out is not after building a Flow.
   */
  it("is refused without a token, and nothing is stored", async () => {
    const { store, result } = await dashboard()

    let created: string | undefined
    await act(async () => {
      created = await result.current.create({
        name: "Moderation bot",
        secret: "  ",
        testServerId: ""
      })
    })

    expect(created).toBeUndefined()
    expect(store.contents.size).toBe(0)
    expect(result.current.creationProblem).toBe(translate("dashboard.create.tokenRequired"))
    // The screen's own message is untouched: nothing is wrong with the list.
    expect(result.current.problem).toBeUndefined()
  })

  it("names an unnamed Project rather than leaving a blank card", async () => {
    const { result } = await dashboard()

    await act(async () => {
      await result.current.create({ name: "   ", secret: "a-token", testServerId: "" })
    })

    expect(result.current.projects?.[0]?.name).toBe(translate("project.untitled"))
  })

  /**
   * A Project's Secret is keyed by its id, so two Projects that shared one
   * would share a bot token.
   */
  it("gives every Project an id of its own", async () => {
    const { result } = await dashboard()

    const made: (string | undefined)[] = []
    for (const name of ["One", "Two"]) {
      await act(async () => {
        made.push(await result.current.create({ name, secret: "a-token", testServerId: "" }))
      })
    }

    expect(made[0]).not.toBe(made[1])
    expect(result.current.projects).toHaveLength(2)
  })

  it("says so when the store would not take the Project, and lists nothing new", async () => {
    const { store, result } = await dashboard()
    store.breaks.create = "the disk is full"

    let created: string | undefined
    await act(async () => {
      created = await result.current.create({ name: "Bot", secret: "a-token", testServerId: "" })
    })

    expect(created).toBeUndefined()
    expect(result.current.creationProblem).toContain("the disk is full")
    expect(result.current.projects).toEqual([])
  })
})

describe("the example", () => {
  it("makes a Project of the user's own, with something already on the Canvas", async () => {
    const { store, result } = await dashboard()

    let created: string | undefined
    await act(async () => {
      created = await result.current.createExample()
    })

    const stored = store.contents.get(created ?? "")
    expect(stored).toBeDefined()
    // The demonstration Project's own Flow, so what the user opens is a bot
    // that already does something rather than an empty Canvas.
    expect(stored?.document).toContain("flow-hello")
    expect(result.current.projects).toHaveLength(1)
  })

  it("is a separate Project every time it is asked for", async () => {
    const { result } = await dashboard()

    const made: (string | undefined)[] = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        made.push(await result.current.createExample())
      })
    }

    expect(made[0]).not.toBe(made[1])
    expect(result.current.projects).toHaveLength(2)
  })

  // The example is there to be looked at, and nobody is asked for a Secret to
  // look at something.
  it("arrives without a token", async () => {
    const { store, result } = await dashboard(fakeProjectStore([emptyProject()]))

    let created: string | undefined
    await act(async () => {
      created = await result.current.createExample()
    })

    await expect(store.hasSecret(created ?? "")).resolves.toBe(false)
  })
})
