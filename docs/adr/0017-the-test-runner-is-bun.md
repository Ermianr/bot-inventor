# The test runner is Bun

Every unit test in the repository runs on `bun test`. Vitest is gone, and with it `vite`, `vitest`, `jsdom`, `@vitejs/plugin-react` and `@rolldown/plugin-babel`. [ADR 0016](./0016-the-editor-is-served-and-bundled-by-bun.md) kept Vite for one reason — Vitest ran on it — and this is that reason ending.

The 52 unit test files and the 16 end-to-end spec files — 99 cases — are the same tests they were, and one unit test file is new. What changed around them is the runner, the DOM and the way two modules are mocked; what did not change is what any of them assert.

## The reason of record: startup, and only startup

Two runs each after a warm-up, same tree, same machine.

| | Vitest | `bun test` |
| --- | --- | --- |
| `packages/schema` | 921 / 990 ms | **112 / 118 ms** |
| `packages/nodes` | 1048 / 1048 ms | **109 / 124 ms** |
| `packages/runtime` | 838 / 931 ms | **76 / 77 ms** |
| `packages/compiler` | 14,069 / 17,850 ms | 15,598 / 16,615 ms |
| `apps/web` | 14,073 / 14,926 ms | **11,344 / 12,185 ms** |

**The win is the runner starting, so it is total where the suite is small and invisible where the suite does real work.** The three small packages go from about a second to about a tenth of one, which is the difference between running them and batching them up. `packages/compiler` does not move at all, because what it spends its time on is esbuild bundling an Export and starting a real Session, and no test runner makes that faster. `apps/web` gains around 20%: it is dominated by the React Compiler's Babel pass and by rendering, and only the startup underneath those came off.

Anyone reading this as "the test suite got much faster" is reading it wrong. Three packages did. The two slow ones are slow for reasons a runner cannot touch, and this table is here so nobody goes looking for a regression when the numbers do not match the headline.

## What it does not buy

**Not a smaller dependency list, in the part that matters.** Babel stays — `@babel/core` and `babel-plugin-react-compiler` — and the next section is why. Playwright stays. Turborepo stays: the `test` task's `dependsOn: ["^build"]` is what makes a package's workspace dependencies resolvable before its tests run, and that is not something to trade away for a shorter list.

What actually left is Vite, Vitest, jsdom and two plugins that existed to bridge Babel into Vite.

## The React Compiler, and why Babel survives

[ADR 0013](./0013-memoization-is-no-longer-written-by-hand.md) puts the React Compiler in the build, and #93 put it in the unit tests, because a compiled build fails in ways uncompiled source cannot — during #88 the compiler turned `translate` into a hook whose memo cache size varied with its argument, and the editor could not draw while every check stayed green.

Bun implements the React Compiler in its bundler, as `bun build --react-compiler`. `bun test` has no equivalent: every key under `[test]` in `bunfig.toml` was checked, and there is no React Compiler and no Babel option for the test runner. So the tests reach it the way the dev server already does — through Babel.

`react-compiler.ts` exports one Bun plugin, and it now has two mounts:

- `bunfig.toml` at the repository root names `./apps/web/react-compiler-plugin.ts` under `[serve.static]`, for the dev server's bundler. That file exists only because `bunfig.toml` loads a plugin by specifier and takes its default export; it re-exports the plugin and does nothing else.
- `apps/web/bun-test.setup.ts` registers the plugin with `Bun.plugin()`, for `bun test`'s runtime.

Same pass, same `reactCompilerOptions`, same source-tree filter. The filter is reused rather than rewritten because it is narrow for a reason: Babel would otherwise run over the built `.js` of every workspace package, one of which it rewrites into an import that cannot resolve.

The Vite-shaped consumer of that preset is gone, and with it `@vitejs/plugin-react`, whose `reactCompilerPreset` was the only thing the repository imported from it. The Bun plugin mounts `babel-plugin-react-compiler` directly.

### A test that fails when the pass stops applying

`apps/web/src/react-compiler.test.tsx` renders `AboutDialog` through `@/components`, the import path every other test in `apps/web` uses, and then reads the component back: one the compiler has taken opens by calling `_c`, the memo-cache hook it imports from `react/compiler-runtime`, and uncompiled source has no such call.

It is one test for the whole application rather than one per file, and it goes through the real import path deliberately — a component defined inside the test file would only prove that the pass matched that file. The fingerprint is a property of the function rather than of the runner, so the test means the same thing whatever runs it.

This closes a hole that was open before this change and is wider after it. The pass is now a plugin registered in a preload, and a plugin that stops matching stops matching quietly — leaving a green suite that is testing the source rather than the build, which is exactly the shape of #88. It was verified by unregistering the plugin and watching the test go red.

## The DOM is happy-dom, registered once

jsdom was selected per file by 20 `// @vitest-environment jsdom` pragmas. `bun test` has no per-file environment, so happy-dom is registered globally in `bun-test.setup.ts` and the pragmas are deleted rather than left as dead comments. There is one place a reader looks for the DOM now.

Two differences between the implementations were found, and each is recorded where it lives:

- **happy-dom navigates for real.** The About dialog's repository link is a navigation, and with navigation on, a unit test run fetched github.com and everything that page pulls in. It is turned off in the registration.
- **happy-dom returns a colour as it was written**, where jsdom rewrote every one into `rgb()`. One assertion in `flow-node.test.tsx` is spelled the way the DOM now answers it. It is the same assertion.

The mocks that patched jsdom's gaps were audited rather than carried over. The `matchMedia` stand-in in `theme-menu.test.tsx` is gone: happy-dom implements it and answers "light", which is what the stand-in said, and a mock of something the DOM implements is a mock that stops noticing when the real answer changes. What replaces it is one assertion pinning that answer, so that a happy-dom default flipping fails there and says so instead of quietly changing what "System" resolves to underneath every test in the file. The `scrollIntoView` spy stays — it was never a gap patch, it is the assertion, since no DOM here lays anything out.

## Mocking, and the hoisting that went with it

`vi.mock` was hoisted above the imports. `mock.module` is not: it runs where it is written. Both call sites were converted individually, and both needed the module under test imported below the mock rather than beside it, because a static import would have been evaluated first and would have closed over the real module. Each now says so at the call site.

`vi.fn` became `mock`, mechanically, at eight sites. `vi.useFakeTimers` and `vi.advanceTimersByTime` came across as they are — `bun:test` exports `vi` and its fake timers work; only `shouldAdvanceTime` is not a Bun option, and it was not needed, since Bun's fake timers leave the microtask queue alone. That the clock is load-bearing rather than decorative was checked by removing the advance and watching two tests fail.

## Types, and one loose assertion per package

`bun:test` types its matchers against what they compare, where Vitest's took anything. That surfaced three assertions that had never type-checked against the values they were asserting on, and each is now explicit about what it means. Nothing about what they assert changed.

One is worth naming, because the obvious fix would have been wrong. `compiler/src/index.test.ts` asserts on a parameter whose type this build knows nothing about — that is the whole of the case — so casting `"channel"` into the declared union would have asserted the opposite of what the test is for. What is widened is the side being read, never the expectation.

The four Node-only packages name `["node", "bun"]` in their `tsconfig.json`, because naming any type package replaces the base config's list rather than adding to it. It is four copies of one line rather than one line in `tsconfig.base.json`, because `packages/ui` and `packages/config` extend that base too and have no `@types/bun` to resolve; putting `bun` there would fail their `check-types` for a runner they do not use.

One rule is off in test files: `typescript/await-thenable`. `bun:test` types `expect(...).rejects.toThrowError()` as returning nothing, so every `await` in front of one reads as an await of a non-promise. The await is what makes the assertion wait.

## Playwright is settled, not pending

**Playwright stays as the end-to-end framework. This is a decision, not an unfinished migration.**

Bun 1.4 ships `Bun.WebView`, and it is headless automation — navigate, click, scroll, screenshot. It has no auto-wait, no retries, no reporters, no fixtures and no trace viewer. It replaces Puppeteer. What Bun 1.4 advertises for this case is the opposite: that Playwright runs on Bun.

Running it on Bun's runtime was the one thing evaluated, and it does not work here. `bunx --bun playwright test` fails before a single spec runs: Bun misreads Playwright's worker entry path as a package specifier and tries to `git clone` it. The specs run on Node, and the 99 of them pass unchanged.

`bun --bun` is in any case opted into per script and never globally through `bunfig.toml`. The esbuild the Compiler invokes for an Export and the Node the Sidecar runs are product, fixed by [ADR 0004](./0004-single-file-export-is-an-esbuild-esm-bundle.md) and [ADR 0002](./0002-bundling-node-js-as-a-tauri-sidecar.md), not tooling to swap for convenience.

## Consequences

- **`--changed`, `--parallel` and `--shard` are available now**, which is most of what the move was for beyond startup. None is on by default. `--parallel` was measured: it takes `packages/compiler` from about 16 s to about 12 s and does nothing for `apps/web`. It stays off in the `test` script because the gain is one package and the cost is a runner that no longer runs a file's tests in a known order, which is not a trade to make on a suite that starts real Sessions. Type it when you want it.
- **`apps/web` has its own `bunfig.toml`.** Bun reads the file from the working directory, and the `test` script runs from `apps/web`, so the root one — which configures the dev server, from the root, deliberately — is not in scope. Two files, two working directories, no inheritance between them.
- **A `bun test` config is a preload, not a config file.** The DOM, the compiler pass and the `act()` flag are three statements in `bun-test.setup.ts`. There is no `test` object to look in, and this ADR is the map.
- **`bun build --react-compiler` still takes no options.** That seam is unchanged by this ADR and is described in ADR 0016: the production bundle runs the compiler on its defaults while the dev server and the tests run it on `reactCompilerOptions`. They agree today.
- **`packages/compiler` did not get faster and will not.** If its 16 seconds ever needs to come down, the thing to attack is how many of its tests bundle an Export or start a Session, not the runner underneath them.
