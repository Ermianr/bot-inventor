import { readExportResult } from "@bot-inventor/compiler"
import { invoke } from "@tauri-apps/api/core"
import { confirm, open } from "@tauri-apps/plugin-dialog"

import { translate } from "@/i18n/messages"
import type { ExportGateway } from "@/project/export-gateway"

/**
 * Exporting through the desktop shell: the operating system's own dialogs for
 * the destination, and the Tauri side for the Export itself.
 *
 * The webview picks nothing and writes nothing. It asks the user where, and
 * hands that path down — the same shape as saving a Project.
 *
 * Both formats ask for a folder, including the one that writes a single file.
 * A save dialog would let the user name that file, and the name an Export
 * writes under is fixed (ADR 0004): they would type `my-bot.mjs` and get
 * `bot.mjs`. Asking where and then saying exactly what was written is the
 * version of this that does not lie to anybody.
 */
export const desktopExports: ExportGateway = {
  chooseDestination: async format => {
    const chosen = await open({
      directory: true,
      multiple: false,
      title: translate(
        format === "single-file" ? "export.destination.file" : "export.destination.folder"
      )
    })
    return chosen ?? undefined
  },

  confirmOverwrite: path =>
    confirm(translate("export.overwrite.message", { path }), {
      title: translate("export.overwrite.title"),
      kind: "warning",
      okLabel: translate("export.overwrite.confirm"),
      cancelLabel: translate("export.overwrite.cancel")
    }),

  run: async request =>
    readExportResult(await invoke<string>("export_project", { request: JSON.stringify(request) }))
}
