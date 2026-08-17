import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"

import { translate } from "@/i18n/messages"
import {
  PROJECT_FILE_EXTENSION,
  type ShareGateway,
  withProjectFileExtension
} from "@/project/share-gateway"

/**
 * Sharing through the desktop shell: the operating system's own save dialog for
 * the destination, and the Tauri side for the write itself.
 *
 * The webview picks nothing and writes nothing. It asks the user where, and
 * hands that path down — the same posture the rest of the editor takes.
 *
 * A save dialog rather than a folder, because the user names this file: the
 * suggestion comes from the Project's name and the extension is offered beside
 * it. Replacing a file that is already there is the dialog's own question, asked
 * in the words the machine asks it in, so nothing above this asks it again.
 */
export const desktopShare: ShareGateway = {
  chooseDestination: async suggestedName => {
    const chosen = await save({
      title: translate("share.destination"),
      defaultPath: suggestedName,
      filters: [{ name: translate("share.fileKind"), extensions: [PROJECT_FILE_EXTENSION] }]
    })
    // The dialog offers the extension and Windows appends it when the user
    // leaves it off, but what comes back is a string and the promise here is
    // that a Project File is one: a user who typed `bot` gets `bot.botinv`.
    return chosen === null ? undefined : withProjectFileExtension(chosen)
  },

  write: (path, document) => invoke("share_project", { path, contents: document })
}
