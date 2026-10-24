import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Tauri expects a fixed port and does not need the terminal cleared.
export default defineConfig({
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["baseLocale"],
      emitTsDeclarations: true,
    }),
    svelte(),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: { include: ["src/**/*.test.ts"] },
});
