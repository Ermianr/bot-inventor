import { browserProjectStore } from "@/project/browser-project-store"
import { desktopProjectStore } from "@/project/desktop-project-store"
import type { ProjectStore } from "@/project/project-store"
import { inDesktopShell } from "@/session/desktop"

/**
 * Where this build keeps Projects. It does not change while the application
 * runs, so it is decided once, here, and every screen is handed the same one.
 */
export const projectStore: ProjectStore = inDesktopShell()
  ? desktopProjectStore
  : browserProjectStore
