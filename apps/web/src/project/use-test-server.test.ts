// @vitest-environment jsdom

import { helloProject } from "@bot-inventor/schema/fixtures"
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { fakeProjectStore } from "@/project/fake-project-store"
import { useTestServer } from "@/project/use-test-server"

/**
 * The Test Server, which used to be typed again before every single run.
 */
describe("the Test Server", () => {
  it("is remembered with the Project rather than asked for again", async () => {
    const store = fakeProjectStore([helloProject()])
    const { result, unmount } = renderHook(() => useTestServer(store, helloProject().id))

    act(() => result.current.choose("123456789"))
    await waitFor(() => {
      expect(store.contents.get(helloProject().id)?.testServerId).toBe("123456789")
    })
    unmount()

    // The next time the Project is opened, which is the whole point: the user
    // picked a server once.
    const reopened = renderHook(() => useTestServer(store, helloProject().id))
    await waitFor(() => {
      expect(reopened.result.current.testServerId).toBe("123456789")
    })
  })

  /**
   * It is not part of the Project. A bot somebody was sent must not point at the
   * sender's server, so the setting sits beside the document and never in it.
   */
  it("is never written into the Project's document", async () => {
    const store = fakeProjectStore([helloProject()])
    const { result } = renderHook(() => useTestServer(store, helloProject().id))

    act(() => result.current.choose("123456789"))
    await waitFor(() => {
      expect(store.contents.get(helloProject().id)?.testServerId).toBe("123456789")
    })

    expect(store.contents.get(helloProject().id)?.document).not.toContain("123456789")
  })

  // The worst a setting that will not load costs is picking a server again.
  it("leaves the field empty when the setting could not be read", async () => {
    const store = fakeProjectStore([helloProject()])
    store.breaks.readTestServer = "the disk is asleep"

    const { result } = renderHook(() => useTestServer(store, helloProject().id))

    await waitFor(() => {
      expect(result.current.testServerId).toBe("")
    })
  })
})
