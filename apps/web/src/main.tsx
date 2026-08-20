import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"

import Loader from "./components/loader"
import { routeTree } from "./routeTree.gen"

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultPendingComponent: () => <Loader />,
  context: {}
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById("app")

if (!rootElement) {
  throw new Error("Root element not found")
}

/*
  Rendered inside StrictMode so that a render with a side effect in it is a
  wrong screen in development rather than a bug a user finds: React runs the
  render twice and throws one away, which is the whole of what makes reading or
  writing anything outside the component visible. The lint check catches the
  patterns it recognises; this catches what is left.
*/
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
}
