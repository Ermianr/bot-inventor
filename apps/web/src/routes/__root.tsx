import { Toaster } from "@bot-inventor/ui/components/sonner"
import { TooltipProvider } from "@bot-inventor/ui/components/tooltip"
import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"

import { THEME_STORAGE_KEY, ThemeProvider } from "@/components/theme-provider"

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
        storageKey={THEME_STORAGE_KEY}
      >
        {/*
          Every explanation a control gives on hover is this editor's own, never
          the operating system's `title`: one appearance, one delay, and one set
          of words that the i18n layer has already translated. The provider sits
          at the root so that delay is the same wherever a tooltip is placed.
        */}
        <TooltipProvider>
          {/*
            Nothing sits above the editor: this is a desktop application, and
            the Menu Bar is what meets the window's title bar.
          */}
          <div className="h-svh">
            <Outlet />
          </div>
        </TooltipProvider>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
    </>
  )
}
