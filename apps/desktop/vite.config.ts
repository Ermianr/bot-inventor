import { resolve } from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import tauriConfig from "./src-tauri/tauri.conf.json" with { type: "json" };

// Tauri expects a fixed port and does not need the terminal cleared.
//
// `--mode e2e` builds the end-to-end entry (`e2e/index.html`, a fake backend and the real app) into
// `dist-e2e`, and `vite preview` serves it with the production CSP of `tauri.conf.json`, so the
// tests run against what ships and not against the dev server, whose CSP is looser.
export default defineConfig(({ mode }) => {
  const e2e = mode === "e2e";
  return {
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
    ...(e2e && {
      build: {
        outDir: "dist-e2e",
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, "index.html"),
            e2e: resolve(import.meta.dirname, "e2e/index.html"),
          },
        },
      },
      preview: {
        port: 4173,
        strictPort: true,
        headers: { "Content-Security-Policy": tauriConfig.app.security.csp },
      },
    }),
    test: { include: ["src/**/*.test.ts"] },
  };
});
