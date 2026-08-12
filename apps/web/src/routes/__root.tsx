import { Toaster } from "@bot-inventor/ui/components/sonner"
import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"

import Header from "@/components/header"
import { ThemeProvider } from "@/components/theme-provider"

import "../index.css"

export type RouterAppContext = Record<string, never>

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "bot-inventor"
      },
      {
        name: "description",
        content: "bot-inventor is a web application"
      }
    ],
    links: [
      {
        rel: "icon",
        href: "/favicon.ico"
      }
    ]
  })
})

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <div className="grid h-svh grid-rows-[auto_1fr]">
          <Header />
          <Outlet />
        </div>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
    </>
  )
}
