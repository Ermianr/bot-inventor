import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * A source tree the React Compiler owns, as a pattern Babel will match against
 * an absolute path on either kind of separator, with Vite's query suffix on the
 * end or nothing at all.
 */
const sourceTree = (packagePath: string) =>
  new RegExp(`[\\\\/]${packagePath.replaceAll("/", "[\\\\/]")}[\\\\/].*\\.[jt]sx?(?:\\?|$)`)

/** Everything the React Compiler compiles: the editor, and the components it draws with. */
const reactSourceTrees = [sourceTree("apps/web/src"), sourceTree("packages/ui/src")]

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
    // The React Compiler. `@vitejs/plugin-react` transforms JSX with oxc and
    // has carried no Babel of its own since v6, so the compiler is mounted as
    // its own Babel pass and the plugin only contributes the preset that
    // describes it. Passing `babel` options to the plugin, as the compiler's
    // own documentation still shows, silently does nothing here.
    //
    // Both the web app and the UI package are in scope. The UI package exports
    // raw `.tsx` from source and is compiled by this Vite, reached through its
    // workspace symlink and resolved to its real path outside `node_modules`.
    // `include` names the two source trees rather than leaning on that: Babel
    // would otherwise also run over the built `.js` of every other workspace
    // package, none of which is React and one of which emits code the compiler
    // rewrites into an import it cannot resolve.
    //
    // The mode is `infer`, not the `all` the ticket asked for. Mode `all` was
    // tried, and opting out the functions it broke was tried with it; both are
    // recorded here because the failures are the reason and not a preference.
    //
    // `all` compiles every function it is handed, not only components and
    // hooks, and this application calls plain functions outside a render. Four
    // separate sites broke, each hidden behind the last: the router's generated
    // `getParentRoute`, the `head` of `__root.tsx`, and `inDesktopShell`, which
    // decides which Project store the build uses as `store.ts` loads. Those
    // three are opt-outs one could live with. The fourth is not: `translate`,
    // which every component in the editor calls during render, is compiled into
    // a hook and allocates a memo cache whose size varies with the message it
    // is given — "the previous cache was allocated with size 7 but size 6 was
    // requested". That is not a boot failure to be patched at four call sites;
    // it is the i18n layer corrupting the hook slots of whatever component
    // called it, and there is no bounded set of directives that ends it.
    //
    // Nothing else guards this. `check-react-rules`, `check-types` and all 405
    // unit tests stayed green while the editor was refusing to draw; only the
    // end-to-end specs caught it, and the unit tests cannot catch it in
    // principle because `vitest.config.ts` runs them without this Babel pass.
    //
    await babel({
      include: reactSourceTrees,
      presets: [
        reactCompilerPreset({
          compilationMode: "infer",
          // Bail-outs are logged and nothing more. This is the compiler's own
          // default, and it is written out because the ticket asks for the
          // behaviour by name and a default is not a promise. The Rules of
          // React are gated by `check-react-rules`, whose rules are stable
          // across versions; the set of bail-outs is not, and gating on it
          // would let a compiler upgrade turn `main` red with nobody having
          // touched the code.
          panicThreshold: "none"
        })
      ]
    })
  ]
}))
