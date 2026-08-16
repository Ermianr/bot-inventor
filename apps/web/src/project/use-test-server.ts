import { useCallback, useEffect, useState } from "react"

import type { ProjectStore } from "@/project/project-store"

/**
 * The Test Server a Project is tried on, remembered between runs.
 *
 * It is the first thing the application stores about a Project that is not part
 * of the Project. It is not a preference of the person — two Projects test on
 * two different servers — and it must not travel inside the `.botinv`, or a bot
 * somebody was sent would point at the sender's server. So it lives beside the
 * Project, behind the same port, and dies with it.
 *
 * A setting that will not load leaves the field empty rather than saying so:
 * the user picks a server again, which is the whole of what was lost.
 */
export type TestServer = {
  testServerId: string
  choose(testServerId: string): void
}

export function useTestServer(store: ProjectStore, projectId: string): TestServer {
  const [testServerId, setTestServerId] = useState("")

  useEffect(() => {
    let current = true

    void store
      .readTestServer(projectId)
      .then(stored => {
        if (current) setTestServerId(stored)
      })
      .catch(() => {
        if (current) setTestServerId("")
      })

    return () => {
      current = false
    }
  }, [store, projectId])

  return {
    testServerId,
    /**
     * The field moves at once and the store catches up. Waiting for the write
     * would make picking a server feel like it did not take, and the worst a
     * failed write costs is picking it again next time.
     */
    choose: useCallback(
      (chosen: string) => {
        setTestServerId(chosen)
        void store.writeTestServer(projectId, chosen).catch(() => {})
      },
      [store, projectId]
    )
  }
}
