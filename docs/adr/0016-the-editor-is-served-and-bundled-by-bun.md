# The editor is served and bundled by Bun

Vite ran the editor's dev server and produced its production bundle. Both now run on Bun: `apps/web/dev-server.ts` is a `Bun.serve` on port 3001, and `apps/web/build.ts` is a `Bun.build` writing the `dist` that `frontendDist` embeds. `vite.config.ts` is gone.

`tauri.conf.json` did not change, and that is the shape of the seam rather than a coincidence: `beforeDevCommand` is `bun run dev`, `devUrl` is `http://localhost:3001` and `beforeBuildCommand` is `bun run build`. Tauri names scripts; this change rewrote what those scripts run.

**Vitest keeps Vite, and Vite therefore stays a devDependency.** (No longer true: [ADR 0017](./0017-the-test-runner-is-bun.md) moved the test runner to `bun test` and Vite left with Vitest. The rest of this paragraph is the state at the time.) The unit tests mount the React Compiler on purpose ([ADR 0013](./0013-memoization-is-no-longer-written-by-hand.md) is why they must), and moving the test runner is a separate change with separate risks. Anyone auditing the tree for `vite` will find it; this paragraph is the answer.

## The reason of record, and what it is not

The build is the reason. Three runs each, same tree, same machine:

| | Vite | Bun |
| --- | --- | --- |
| Production build | 4350 / 4759 / 5658 ms | **979 / 998 / 1021 ms** |
| Dev server answering | 1235 / 1274 / 1551 ms | **73 / 241 / 271 ms** |
| Entry chunk | 237,599 B | **204,736 B** |

**Hot module replacement is not the reason, because there is no gain in it.** Vite turned an edit around in about 150 ms and Bun does it in about 190 ms; on an identical minimal application the two were 30–43 ms and 30–50 ms. #122 was written on the thesis that the dev-server half was the prize and the bundler half the easy part. The measurement says the opposite, and it is recorded here so the change is not remembered as an HMR improvement and defended on that ground.

**Code splitting is not the reason either.** `vite.config.ts` already carried `autoCodeSplitting: true`, so the Project editor was already a chunk of its own and the entry was already 237 KB. What this change did was reproduce that by hand, because Bun has no equivalent plugin. The 14% the entry chunk lost is real; anything larger quoted for this change is a comparison of Bun against itself with splitting turned off, and is not a comparison with Vite.

## The patched dependency

`@tanstack/router-core` is patched, and without the patch the editor does not mount under the Bun dev server at all — a blank page and one console error:

```
TypeError: Cannot read properties of null (reading 'replaceRouteChunk')
```

`router.js` and `load-client.js` in that package import each other. `router.js` reads `replaceRouteChunk` in its module body, inside the `process.env.NODE_ENV !== "production"` block that exists to support HMR. Bun's dev-server bundler resolves that cyclic import to a namespace object that is still null while the modules initialise, so the read throws before anything renders. The patch defers the read to call time; the cycle is untouched.

**This is a defect in Bun, not in TanStack Router and not in this repository.** It was reduced to a ten-line reproduction with no TanStack in it: two modules importing each other, one reading the other's binding at init. Node runs it, Bun's runtime runs it, `bun build` runs it, and only Bun's dev server returns null. The `NODE_ENV` guard is why production was never affected and why #115, which tested `bun build`, could not have found this.

The patch is `bun patch`, so it is three committed things — `patches/@tanstack%2Frouter-core@1.171.26.patch`, a `patchedDependencies` entry, and an `overrides` entry — and `bun install` applies it with no further step. A clean clone was used to confirm that rather than assumed.

### Both of its failure modes are silent, and both are guarded

The symptom of this patch not applying is a blank editor. There is no error at install time and nothing in the diff of a version bump that points at it, so two guards exist:

- **`patchedDependencies` is keyed by exact version.** Any bump to `router-core` — including one arriving through some other TanStack package — drops the patch without a word.
- **Which copy of `router-core` wins moves with install order.** `@tanstack/react-router` pins its own; adding `@tanstack/router-core` as a direct dependency was tried during this work and flipped the copy the router loads to an unpatched one, restoring the original crash. `overrides` pins it to a single version so that cannot happen.

`apps/web/src/router-core-patch.test.ts` reads the file from the copy `@tanstack/react-router` resolves — deliberately not from whatever `require.resolve` finds first, because during this work a guard that checked the wrong copy sat green on top of a broken application for several minutes. It was verified by reverting the patch in place and watching both assertions fail.

**The patch is a workaround with an expiry.** When Bun fixes cyclic-import resolution in its dev server, the patch, the `overrides` entry and that test all go. Until then, a TanStack Router upgrade means regenerating the patch, and the red test is how that is found out.

## What Vite did for free, and where it landed

- **Route tree generation.** `@tanstack/router-plugin` generated the tree from inside the bundler. Bun cannot use it: the plugin's esbuild entrypoint ships the generator and the code splitter as inert stubs, which is what #115 established. Its own `tsr watch` CLI is not the fallback either — it writes the tree by atomic rename, the dev server holds the file open because it is in the module graph, and Windows refuses the replace. The CLI does not survive it: the process exits, the dev server does not, and what is left is a Route tree that has silently stopped updating. Reproduced three times out of three. So `scripts/route-tree.ts` drives the generator through its own API with one method of its injectable file system replaced — `rename` becomes a copy onto the destination, which Windows permits against an open handle.
- **The React Compiler.** Bun applies it in its bundler and not in its dev server. `bun build --react-compiler` performs the real transform; on the dev server the served bundle is byte-identical with `reactCompiler = true` set under `[serve.static]` and without it. The key exists and does nothing. So `react-compiler.ts` also exports a Bun plugin around the same Babel pass and the same scope. This is not a parity nicety: with the compiler absent the editor enters an infinite render loop in React Flow's store updater and never draws.
- **Route code splitting.** Declared by hand with `createLazyFileRoute` on the Project editor, which is the Route worth splitting.
- **Tailwind.** `bun-plugin-tailwind`, mounted twice — in `bunfig.toml` for the dev server, and passed directly in `build.ts`.

## The Tailwind sources, and a bug Vite was hiding

Tailwind resolves `@source` relative to the file that declares it. The globs live in `packages/ui/src/styles/globals.css`, and the one meant to reach the applications is anchored there: it resolves to `packages/apps`, a directory that does not exist. That glob has always been wrong. `@tailwindcss/vite` hid it by anchoring sources at Vite's root, and the production build still hides it because automatic detection roots at `apps/web`. Only the Bun dev server, which runs from the repository root, had nothing to compensate with.

The result was not a broken-looking page. Components from `packages/ui` kept every utility they use, so buttons and dialogs were correct and only the editor's own screens — its spacing, its type scale, the Canvas grid tracks — came out unstyled. The dev server served 315 selectors where it now serves 397.

**It also cost the Canvas its geometry, and that is the part worth remembering.** Without the layout utilities every drag landed where the Canvas was not, and six end-to-end specs failed on wire drawing and Node dragging — failures that read as a React Flow or bundler problem and were chased as one for some time. `apps/web/src/index.css` now names the editor's own source tree, which is where that belongs and holds wherever the bundler is run from. The wrong glob in `packages/ui` is left alone: correcting it would make the shared package reach into `apps/`, which is a layering question and not this change's to settle.

## Consequences

- **The bundle is larger, and it is entirely `zod`.** Total JavaScript goes from 1,070,494 B to 1,345,547 B. Broken down per package against the same source, `zod` accounts for +327 KB unminified where the whole delta is +302 KB; everything else roughly cancels, and Bun is smaller on the application's own code, on `@tauri-apps/api` and on `tailwind-merge`. `import { z } from "zod"` is a barrel object and Rolldown prunes it to 136 KB where Bun keeps 463 KB. For a Tauri application loading from local disk this costs nothing a user can feel, and the entry chunk — the part that does matter — got smaller. Moving the schemas to `zod/mini` is the fix if that ever changes, and it is a change to `packages/schema` and `packages/compiler`, not to the build.
- **The React Compiler compiles a superset of what it compiled under Vite** — 95 components against 75. `@vitejs/plugin-react` strips the types and the JSX with oxc before the compiler's Babel pass sees a file, so the compiler read `jsx()` calls; the Bun plugin hands it the source as written and it infers more aggressively. Matching Vite's ordering was tried, cost Fast Refresh and fixed nothing, and was reverted. The difference is measured and inert — every unit test and all 99 end-to-end specs pass either way — but it is a real divergence and this is where a future surprise should start looking.
- **`bun build --react-compiler` takes no options.** The production bundle therefore runs the compiler on its defaults while the dev server and the unit tests run it on `reactCompilerOptions`. Those agree today, `infer` and `none` being the defaults. The day that file wants anything else, production stops agreeing with the tests and nothing will say so; `build.ts` carries the warning at the flag.
- **Fast Refresh disappears in silence if `react-refresh` is not installed.** Bun resolves that package itself and disables the transform without a message when it cannot. It is a root devDependency for that reason. During this work the loss was misattributed to the compiler plugin's filter breadth, and the note in `react-compiler.ts` exists so the next person checks the dependency first — a broad filter was later measured and does not cause it.
- **The dev server runs from the repository root, and `bunfig.toml` lives there because of it.** Bun binds its file watcher to the working directory and refuses everything outside it; started from `apps/web`, every file in `packages/ui` comes back as "not in the project directory and will not be watched" and editing a shared component does nothing until a restart. `Bun.serve` accepts no `plugins` option, so the plugins have to be in the `bunfig.toml` the working directory selects.
- **`src-tauri` needs no watch exclusion, and the reason is structural.** `vite.config.ts` carried one because Vite watches directory trees, and `tauri dev` writing into `target` while the dev server is up takes the watcher down with an EBUSY on Windows. Bun watches only the files it resolved into the module graph, so nothing under `src-tauri` is ever watched. This was tested rather than assumed: 1,560 files and roughly 6 GB written into `src-tauri/target` with the server up, no EBUSY, still serving.
- **`turbo.json` declares `src/routeTree.gen.ts` as a build output.** The tree is generated by `build` and is gitignored, so without that a cache hit restores `dist/**` and leaves the tree stale — which costs the code splitting and produces a single-chunk bundle. This is not hypothetical; it happened during this work.
- **`index.html` points at `./src/main.tsx` rather than `/src/main.tsx`.** Bun resolves the entry relative to the document; Vite resolved it from its root.
- **`serve` and `start` are gone.** They were `vite preview` and `vite`, and nothing referenced either.
