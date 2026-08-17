import type { Project } from "@bot-inventor/schema"
import { invoke } from "@tauri-apps/api/core"

import { type ProjectStore, type StoredProject, serializeProject } from "@/project/project-store"

/**
 * The Projects the desktop shell holds, in the folder it keeps them in.
 *
 * Nothing here names a folder. The webview hands over a Project id and gets a
 * document back; `src-tauri/src/projects.rs` is what knows where that document
 * lives, and it is the only thing that ever will.
 */
export const desktopProjectStore: ProjectStore = {
  list: () => invoke<StoredProject[]>("list_projects"),

  /**
   * The Secret goes first, and the folder only once it is in.
   *
   * The keychain and the folder cannot be written as one, so the order decides
   * what a half-done creation leaves behind. A folder written first and a
   * keychain that then refused would put a Project on the Dashboard that cannot
   * run — the one state the Dashboard is meant never to hold. This way round,
   * a refusal leaves an entry under an id no Project ever took, which nothing
   * looks for and nothing is broken by.
   */
  create: async (project, locals) => {
    // A Project made without one — the example, or a copy of another Project —
    // gets no keychain entry at all. Storing an empty string would make one,
    // and an entry that exists is what `secret_exists` calls having a token: it
    // would leave the Run button live for a Project that cannot sign in.
    if (locals.secret.length > 0) {
      await invoke("store_secret", { projectId: project.id, secret: locals.secret })
    }
    await invoke("create_project", {
      projectId: project.id,
      contents: serializeProject(project)
    })
    await invoke("write_test_server", {
      projectId: project.id,
      testServerId: locals.testServerId
    })
  },

  read: projectId => invoke<string>("read_project", { projectId }),

  write: async (project: Project) => {
    await invoke("write_project", {
      projectId: project.id,
      contents: serializeProject(project)
    })
  },

  backUp: async projectId => {
    await invoke("back_up_project", { projectId })
  },

  readTestServer: projectId => invoke<string>("read_test_server", { projectId }),

  writeTestServer: async (projectId, testServerId) => {
    await invoke("write_test_server", { projectId, testServerId })
  },

  hasSecret: projectId => invoke<boolean>("secret_exists", { projectId }),

  storeSecret: async (projectId, secret) => {
    await invoke("store_secret", { projectId, secret })
  },

  /**
   * The Secret goes first, and the folder only once it is gone — the mirror of
   * the order creation takes, and for the same reason.
   *
   * A folder deleted first and a keychain that then refused would leave a bot
   * token for a Project nothing points at any more, which is the one thing
   * deleting must never leave. This way round, a refusal leaves a Project the
   * user can see and delete again, with nothing but its token already gone.
   */
  remove: async projectId => {
    await invoke("delete_secret", { projectId })
    await invoke("delete_project", { projectId })
  }
}
