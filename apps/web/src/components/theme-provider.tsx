import { ThemeProvider as NextThemesProvider } from "next-themes"
import type * as React from "react"

/**
 * Where the chosen theme is kept between one run of the application and the
 * next. Named here rather than at the root, so that a test asking whether the
 * choice survives a restart is asking about the place the application uses.
 */
export const THEME_STORAGE_KEY = "vite-ui-theme"

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

export { useTheme } from "next-themes"
