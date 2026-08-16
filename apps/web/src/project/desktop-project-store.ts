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

  create: async (project, credentials) => {
    await invoke("create_project", {
      projectId: project.id,
      contents: serializeProject(project)
    })
    // The token before the Test Server, because it is the one a Project cannot
    // run without: a creation that failed halfway is better off missing the
    // setting the user can change in a moment than missing the credential.
    await invoke("store_secret", { projectId: project.id, secret: credentials.secret })
    await invoke("write_test_server", {
      projectId: project.id,
      testServerId: credentials.testServerId
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
  }
}
