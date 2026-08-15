import { Button } from "@bot-inventor/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@bot-inventor/ui/components/dropdown-menu"

import { translate } from "@/i18n/messages"
import type { Exporting } from "@/project/use-export"

/**
 * Taking the bot away, in the two shapes it comes in.
 *
 * Both are offered together rather than behind a setting, because which one a
 * user wants is not a preference — it is what they are about to do with it, and
 * the line under each is the whole of what they need to choose.
 */
export function ExportButton({ exporting }: { exporting: Exporting }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" disabled={exporting.busy} />}
      >
        {exporting.busy ? translate("export.working") : translate("export.title")}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="max-w-80">
        <DropdownMenuItem
          className="flex-col items-start gap-0.5"
          onClick={() => void exporting.exportAs("single-file")}
        >
          <span className="font-medium">{translate("export.singleFile")}</span>
          <span className="text-muted-foreground text-xs">
            {translate("export.singleFile.help")}
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex-col items-start gap-0.5"
          onClick={() => void exporting.exportAs("node-project")}
        >
          <span className="font-medium">{translate("export.nodeProject")}</span>
          <span className="text-muted-foreground text-xs">
            {translate("export.nodeProject.help")}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
