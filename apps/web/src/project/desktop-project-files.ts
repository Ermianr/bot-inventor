import { invoke } from "@tauri-apps/api/core"
import { confirm, open, save } from "@tauri-apps/plugin-dialog"

import { translate } from "@/i18n/messages"
import { PROJECT_FILE_EXTENSION, type ProjectFileGateway } from "@/project/project-file"

/**
 * Saving and opening a Project through the desktop shell: the operating
 * system's own file dialogs, and the Tauri side for the file itself.
 *
 * Reading and writing do not happen here because the webview has no business
 * touching a path of its own choosing; `src-tauri/src/project_file.rs` does it,
 * on the path the user picked in a dialog.
 */
export const desktopProjectFiles: ProjectFileGateway = {
  read: path => invoke<string>("read_project_file", { path }),

  write: async (path, contents) => {
    await invoke("write_project_file", { path, contents })
  },

  backUp: path => invoke<string>("back_up_project_file", { path }),

  chooseSavePath: async suggestedName => {
    const chosen = await save({
      defaultPath: suggestedName,
      filters: [projectFilter()]
    })
    return chosen ?? undefined
  },

  chooseOpenPath: async () => {
    const chosen = await open({
      multiple: false,
      directory: false,
      filters: [projectFilter()]
    })
    return chosen ?? undefined
  },

  confirmDiscard: projectName =>
    confirm(translate("project.discard.message", { project: projectName }), {
      title: translate("project.discard.title"),
      kind: "warning",
      okLabel: translate("project.discard.confirm"),
      cancelLabel: translate("project.discard.cancel")
    })
}

/** What the file dialogs offer to show: Projects. */
function projectFilter() {
  return { name: translate("project.file.filter"), extensions: [PROJECT_FILE_EXTENSION] }
}
