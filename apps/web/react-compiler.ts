import { transformAsync } from "@babel/core"
import babel from "@rolldown/plugin-babel"
import { reactCompilerPreset } from "@vitejs/plugin-react"
import reactCompilerBabelPlugin from "babel-plugin-react-compiler"
import type { BunPlugin } from "bun"

/**
 * A source tree the React Compiler owns, as a pattern Babel will match against
 * an absolute path on either kind of separator, with Vite's query suffix on the
 * end or nothing at all.
 */
const sourceTree = (packagePath: string) =>
  new RegExp(`[\\\\/]${packagePath.replaceAll("/", "[\\\\/]")}[\\\\/].*\\.[jt]sx?(?:\\?|$)`)

/** Everything the React Compiler compiles: the editor, and the components it draws with. */
const reactSourceTrees = [sourceTree("apps/web/src"), sourceTree("packages/ui/src")]

/**
 * The same two trees as one pattern, for callers that accept a single regular
 * expression rather than a list.
 *
 * It is the `include` of `reactCompiler()` expressed the other way round, and it
 * is narrow for the same reason: Babel would otherwise run over the built `.js`
 * of every workspace package and over `node_modules`, which is both slow and
 * wrong. Bun's own React Fast Refresh transform still runs on the files this
 * claims — that was measured, in case the breadth of this pattern ever looks
 * like the reason Fast Refresh has stopped working. It is not; check that
 * `react-refresh` is installed, because Bun disables Fast Refresh without
 * saying so when it cannot resolve that package.
 */
const reactSourceFilter = new RegExp(reactSourceTrees.map(tree => tree.source).join("|"))

/**
 * How the React Compiler is configured, in one place because three callers now
 * mount it: the unit tests through Babel, the Bun dev server through Babel, and
 * the production bundle through `bun build --react-compiler`. The first two read
 * this; the third cannot, and that is the one seam to keep an eye on.
 *
 * The mode is `infer`, not the `all` that #86 asked for and #88 was to deliver.
 * Mode `all` was tried, and opting out the functions it broke was tried with it;
 * both are recorded here because the failures are the reason and not a
 * preference.
 *
 * `all` compiles every function it is handed, not only components and hooks, and
 * this application calls plain functions outside a render. Four separate sites
 * broke, each hidden behind the last: the router's generated `getParentRoute`,
 * the `head` of `__root.tsx`, and `inDesktopShell`, which decides which Project
 * store the build uses as `store.ts` loads. Those three are opt-outs one could
 * live with. The fourth is not: `translate`, which every component in the editor
 * calls during render, is compiled into a hook and allocates a memo cache whose
 * size varies with the message it is given — "the previous cache was allocated
 * with size 7 but size 6 was requested". That is not a boot failure to be
 * patched at four call sites; it is the i18n layer corrupting the hook slots of
 * whatever component called it, and there is no bounded set of directives that
 * ends it.
 *
 * Bail-outs are logged and nothing more. This is the compiler's own default, and
 * it is written out because #88 asks for the behaviour by name and a default is
 * not a promise. The Rules of React are gated by `check-react-rules`, whose
 * rules are stable across versions; the set of bail-outs is not, and gating on
 * it would let a compiler upgrade turn `main` red with nobody having touched the
 * code.
 */
export const reactCompilerOptions = {
  compilationMode: "infer",
  panicThreshold: "none"
} as const

/**
 * The React Compiler as a Babel pass, which is what the unit tests mount.
 * `vitest.config.ts` calls it once.
 *
 * `@vitejs/plugin-react` transforms JSX with oxc and has carried no Babel of
 * its own since v6, so the compiler is mounted as its own Babel pass and the
 * plugin only contributes the preset that describes it. Passing `babel` options
 * to the plugin, as the compiler's own documentation still shows, silently does
 * nothing here.
 *
 * Both the web app and the UI package are in scope. The UI package exports raw
 * `.tsx` from source, reached through its workspace symlink and resolved to its
 * real path outside `node_modules`. `include` names the two source trees rather
 * than leaning on that: Babel would otherwise also run over the built `.js` of
 * every other workspace package, none of which is React and one of which emits
 * code the compiler rewrites into an import it cannot resolve.
 */
export const reactCompiler = () =>
  babel({
    include: reactSourceTrees,
    presets: [reactCompilerPreset(reactCompilerOptions)]
  })

/**
 * The React Compiler for the Bun dev server, as a Bun plugin around the same
 * Babel pass and the same scope.
 *
 * It exists because Bun applies the compiler in its bundler and not in its dev
 * server: `bun build --react-compiler` performs the real transform, while the
 * dev server emits byte-identical output with the flag set and without it, and
 * there is no setting that changes that. Development would otherwise run
 * uncompiled code and production would ship compiled code, which is the exact
 * divergence #93 exists to prevent — the compiler breaks things that only show
 * up when something actually loads the compiled output.
 *
 * `bun build --react-compiler` cannot read `reactCompilerOptions`, so the
 * production bundle takes the compiler's defaults while this pass and the unit
 * tests take ours. They agree today, `infer` and `none` being the defaults, and
 * `build.ts` says so where it passes the flag.
 */
export const reactCompilerBunPlugin: BunPlugin = {
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: reactSourceFilter }, async args => {
      const source = await Bun.file(args.path).text()
      const compiled = await transformAsync(source, {
        filename: args.path,
        // Bun hands over the file as written, so Babel is told what it is
        // parsing rather than inferring it. Nothing else in the pipeline has
        // stripped the types or the JSX yet.
        parserOpts: { plugins: ["jsx", "typescript"] },
        plugins: [[reactCompilerBabelPlugin, reactCompilerOptions]],
        // The compiler is the only pass wanted here; Bun still does the rest.
        babelrc: false,
        configFile: false
      })

      return { contents: compiled?.code ?? source, loader: args.path.endsWith("x") ? "tsx" : "ts" }
    })
  }
}
