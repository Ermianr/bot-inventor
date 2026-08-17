import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"

import { translate } from "@/i18n/messages"
import type { ImportGateway } from "@/project/import-gateway"
import { PROJECT_FILE_EXTENSION } from "@/project/share-gateway"

/**
 * Importing through the desktop shell: the operating system's own open dialog
 * for the file, and the Tauri side for the read itself.
 *
 * The webview picks nothing and reads nothing. It asks the user which file, and
 * hands that path down — the same posture Share takes with the path it writes
 * to, and for the same reason: what makes a path outside the application's
 * storage safe to touch is that a dialog the user opened is where it came from.
 *
 * The filter offers Project Files, so that a folder of screenshots and
 * documents shows the one thing that can be imported from it.
 */
export const desktopImport: ImportGateway = {
  chooseSource: async () => {
    const chosen = await open({
      multiple: false,
      directory: false,
      title: translate("import.source"),
      filters: [{ name: translate("share.fileKind"), extensions: [PROJECT_FILE_EXTENSION] }]
    })
    return chosen ?? undefined
  },

  read: path => invoke<string>("read_project_file", { path })
}
