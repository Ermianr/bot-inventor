import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { reactCompiler } from "./react-compiler.ts"

export default defineConfig(async () => ({
  server: {
    port: 3001,
    watch: {
      // The Tauri side is not part of the frontend, and watching it is actively
      // harmful: `tauri dev` writes into `target` and the sidecar's own binary
      // while the dev server is up, and Windows refuses to watch a file that is
      // being written, which takes the dev server down with an EBUSY.
      ignored: ["**/src-tauri/**"]
    }
  },
  resolve: {
    tsconfigPaths: true
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true
    }),
    react(),
    // The React Compiler, declared in `react-compiler.ts` so that the unit
    // tests mount the very same pass; see there for what it does and why.
    await reactCompiler()
  ]
}))
