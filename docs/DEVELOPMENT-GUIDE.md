# DEVELOPMENT GUIDE

Central place for the best practices of the languages and frameworks used in the project. `TOOLING.md` says **what** we use, `DECISIONS.md` says **what was decided and why**, and this guide says **how to use it well**.

## How to read this guide

Every rule carries one of these tags, so you can tell where it comes from:

- **[official]**: taken from the maintainers' own documentation or source (sources are listed at the end of each section).
- **[project]**: a convention we chose for this repository.
- **[verify]**: believed to be correct but not checked against a source or in code yet. Do not rely on it without checking.

Rules are only added to a section after that technology has been researched.

## Contents

[1 Effect](#1-effect-frontend) · [2 TypeScript](#2-typescript) · [3 Svelte 5 and the Tauri frontend](#3-svelte-5-and-the-tauri-frontend) · [4 Tailwind CSS v4 and `bits-ui`](#4-tailwind-css-v4-and-bits-ui) · [5 ESLint and Prettier](#5-eslint-and-prettier-for-svelte-and-typescript) · [6 Rust](#6-rust) · [7 Tauri v2](#7-tauri-v2) · [8 twilight](#8-twilight) · [9 SQLite with `rusqlite`](#9-sqlite-with-rusqlite) · [10 Testing](#10-testing-across-rust-and-typescript) · [11 Repository tooling and the minimal baseline](#11-repository-tooling-and-the-minimal-baseline) · [12 Expressions (CEL)](#12-expressions-cel)

---

## 1. Effect (frontend)

Decision: Effect is integrated in the frontend (see *Frontend stack* in `DECISIONS.md`). It does not run inside the exported bots, which are Rust.

### 1.1 Version and stability

- **[official]** Use **Effect 4**. At the time of writing, npm `latest` is `effect@4.0.5` (published 2026-10-15); the previous major is `3.22.3`.
- **[official]** The ecosystem shares **one version number**. If `effect` is `4.0.5`, the matching `@effect/vitest` is `4.0.5`. Bump them together.
- **[official]** Many v3 packages were merged into `effect` (`@effect/platform`, `@effect/rpc`, …). Do not install them, and do not install `@effect/schema` (Schema now lives in `effect`).
- **[official]** Every module declares its stability. `@stability stable` follows strict semver; `unstable` modules may break in minor releases and `experimental` ones in patch releases. We checked `Schema` and `ManagedRuntime` in `effect@4.0.5`: both are `stable`.
- **[project]** Use only `stable` modules by default. Importing an `unstable` or `experimental` module needs a note in the pull request, and `effect` must then be pinned to an exact version (no `^`).
- **[project]** Pin `effect` and `@effect/vitest` to the same exact version in `package.json`, and bump them in a dedicated pull request.
- **Beware of outdated material.** Most blog posts, tutorials and AI answers describe v3 (`Effect.Service`, `Context.Tag`, `Effect.catchAll`, `@effect/schema`). The official documentation itself says to avoid unrelated copies of Effect docs because they may be outdated. When in doubt, read the type declarations in `node_modules/effect`.

### 1.2 Where Effect is used (scope)

- **[project]** Effect owns **the boundaries and the I/O**: calls to the Tauri backend (including asking Rust to open a project, which Rust validates), streaming bot logs and events, retries, cancellation and resource cleanup.
- **[project]** Effect does **not** own presentation. Svelte components stay plain Svelte 5; pure helpers stay plain TypeScript functions. Do not wrap a pure function in `Effect` just to use it.
- **[project]** This keeps the barrier to contribute low: someone fixing a button should not need to know Effect.
- **[official]** For validation and domain modeling use `Schema`. Avoid hand-written predicates and manual parsing of untrusted data.

### 1.3 Writing effects

- **[official]** Use `Effect.gen` for inline code. For reusable functions use `Effect.fn("name")`, or `Effect.fnUntraced` when tracing is not useful (hot paths, library internals). Do not write a function that only wraps and returns an `Effect.gen`.
- **[official]** The name passed to `Effect.fn` should match the function name; it improves stack traces and creates a tracing span.
- **[official]** Extra behavior goes in the additional arguments of `Effect.fn`. **Do not use `.pipe` with `Effect.fn`.**
- **[official]** Always `return yield*` when raising an error, so TypeScript knows the function does not continue.
- **[official]** Do not write your own `isRecord`/`isString` helpers; use the `Predicate` module.
- **[official]** Use the `DateTime` module instead of `Date` and `Date.now`, so time can be controlled in tests.

```ts
// illustrative: `backend`, `decodeProject`, `Project` and `ProjectLoadError` are not defined here
import { Effect } from "effect"

export const loadProject = Effect.fn("loadProject")(
  function* (path: string): Effect.fn.Return<Project, ProjectLoadError> {
    const raw = yield* backend.readFile(path)
    return yield* decodeProject(raw)
  },
  Effect.annotateLogs({ module: "project" })
)
```

### 1.4 Services and layers

- **[official]** Structure behavior as **services**. Define them by extending `Context.Service`, with the interface as a type parameter and the identifier as the argument of the returned constructor. The identifier should include the package name and the path of the service file.
- **[official]** Attach a `static readonly layer` to the service. Name layers `layer`, with suffixes for variants (`layerTest`). The v3 names `Default` and `Live` are gone.
- **[official]** `Context.Service` with `make` does not generate a layer; build it explicitly with `Layer.effect` and wire dependencies with `Layer.provide`. The `dependencies` option no longer exists.
- **[official]** Prefer `yield* Service` inside `Effect.gen` over `Service.use(...)`: it keeps dependencies visible and stops them leaking into return values.
- **[official]** Use `Context.Reference` for values with a default (configuration, feature flags).
- **[project]** One service per file under `src/services/`, named after the identifier path, for example `"bot-inventor/services/TauriBackend"`.

```ts
// src/services/ProjectStore.ts  (illustrative)
import { Context, Effect, Layer } from "effect"
import { TauriBackend } from "./TauriBackend"

export class ProjectStore extends Context.Service<ProjectStore, {
  load(path: string): Effect.Effect<Project, ProjectLoadError>
}>()("bot-inventor/services/ProjectStore") {
  static readonly layer = Layer.effect(
    ProjectStore,
    Effect.gen(function* () {
      const backend = yield* TauriBackend
      const load = Effect.fn("ProjectStore.load")(function* (path: string) {
        const raw = yield* backend.readProject(path)
        return yield* decodeProject(raw)
      })
      return ProjectStore.of({ load })
    })
  )
}
```

### 1.5 Errors

- **[official]** Define errors with `Schema.TaggedError`. Give each failure its own specific name; avoid generic errors. They are serializable and carry a `_tag`.
- **[official]** Handle them with `Effect.catchTag` / `Effect.catchTags`. Use the catch-all `Effect.catch` only as a final fallback. (v3 `catchAll` is now `catch`.)
- **[official]** Use `Schema.Defect()` for a field that holds an unknown underlying cause.
- **[official]** In v4, recovery operators skip a cause that mixes a typed error with a **defect**, so the handler does not run. Use `Effect.catchDefect` or `Effect.catchCause` when you really need to recover from defects. `mapError` preserves defects and interrupts.
- **Do not `throw` inside `Effect.gen`.** A thrown exception becomes an untyped defect. Fail with a tagged error instead. **[verify]** This comes from third-party guidance and matches the defect behavior above, but was not checked in code.
- **[project]** Errors that cross from Rust (Tauri command errors) are decoded into a tagged error at the boundary, never passed on as `unknown`.

```ts
import { Schema } from "effect"

export class ProjectLoadError extends Schema.TaggedError<ProjectLoadError>()(
  "ProjectLoadError",
  { path: Schema.String, cause: Schema.Defect() }
) {}
```

### 1.6 Schema and data at the boundaries

- **[official]** Decode `unknown` input once, at the edge, into typed values; code inside the edge works with typed values only.
- **[official]** The API for decoding in an Effect pipeline is `Schema.decodeUnknownEffect(schema)(input)` (checked in `effect@4.0.5`), which fails with `SchemaError`.
- **[project]** Rust is the source of truth for data types. **Rust loads and validates `.botproj` projects** in the `graph` crate, the same one used by the runtime and the exporter; the frontend never parses a project file itself.
- **[project]** TypeScript types for commands and events are **generated from Rust** with `tauri-specta` (section 7). Data coming from Rust is not decoded again with `Schema`; the generated bindings are its type.
- **[project]** Effect `Schema` is used for values that originate in the frontend (form input, UI settings) and for anything that reaches TypeScript as `unknown`. It replaces `zod`; do not add `zod`.
- **[verify]** Effect can build a `Schema` from a JSON Schema document (`SchemaRepresentation.fromJsonSchemaDocument`, `@stability stable`, best-effort translation without static types). It is a possible fallback if Rust-driven forms are wanted; it is not used now.

### 1.7 Running effects: one runtime

- **[official]** `ManagedRuntime` bridges Effect programs with non-Effect code. Build **one** runtime from the application layer and use it wherever imperative execution is needed.
- **[official]** Share a memo map (`Layer.makeMemoMapUnsafe()`) so layer memoization works across runtime instances.
- **[official]** Dispose the runtime with `dispose` / `disposeEffect` when the application shuts down. Run with `runPromise`, `runFork`, `runCallback` or `runSync` at the edges.
- **[project]** `runtime.run*` is called only from the **bridge layer** (event handlers, `onMount`, stores in `.svelte.ts` files), never scattered through components or services.
- **[project]** Keep the application layer in a single file (`src/app/runtime.ts`) so the dependency graph is visible in one place.
- **[project]** Create the single `ManagedRuntime` at module scope and dispose it in `import.meta.hot.dispose`, Vite's cleanup hook for hot reload, inside an `if (import.meta.hot)` guard so a reload does not leave a second runtime alive. Vite documents the hook; pairing it with `ManagedRuntime` is our own inference, so check it when scaffolding.

### 1.8 Svelte 5 integration

- **[official]** Effect ships framework bindings for **React, Solid and Vue** (`@effect/atom-*`). There is **no Svelte binding**.
- **[project]** We write a small bridge instead, in `.svelte.ts` modules: Effect fibers update `$state` values, and the component reads the rune. Effect code never touches the DOM.
- **[project]** A fiber started by a component must be interrupted when the component is destroyed (for example in the cleanup function of `$effect`), so streams do not leak.
- **[project]** Long-lived streams (bot logs, bot status) are consumed with `Stream`, forked once by the bridge, and written into a rune store. Components read the store.
- **[verify]** A third-party package exists (`@barekey/svelte-effect-runtime`); it was not evaluated and it is not part of Effect. Do not adopt it without a review of its maintenance and size.

### 1.9 Tauri integration

All of this is **[project]** and **[verify]**: it follows from the official patterns above, but no Tauri-specific Effect guidance was found.

- Wrap every `invoke` call in a `TauriBackend` service, using `Effect.tryPromise` with a `catch` mapper that produces a tagged error. Components and other services never call `invoke` directly.
- Command and event types come from the generated bindings, so responses from Rust are not decoded again. If a command can return a value that Rust does not type (an opaque JSON value), decode that value with `Schema` before it leaves `TauriBackend`.
- Turn Tauri events into a `Stream` with `Stream.callback`, and unsubscribe in the finalizer, so cancelling the stream stops the listener.
- Provide a `layerTest` for `TauriBackend` that answers from memory, so the frontend logic can be tested without Tauri.

### 1.10 Resources, time and observability

- **[official]** Manage resources with `Effect.acquireRelease` and `Scope`; use `Layer.effectDiscard` for background tasks that do not expose a service.
- **[official]** Effect has built-in structured logging, tracing and metrics. For exporting telemetry use the lightweight `Otlp` modules from `effect/observability` in new projects.
- **[project]** For now use logging and spans only for the frontend's own diagnostics. No telemetry leaves the user's machine.

### 1.11 Testing

- **[official]** Use `@effect/vitest`: `it.effect` for Effect tests, `it.live` for tests that need the real clock, and `TestClock.adjust` to move virtual time. Property tests use `it.effect.prop` with Schema-based arbitraries.
- **[official]** Test services with shared layers.
- **[project]** Services expose a `layerTest`; tests provide it instead of mocking modules.
- **[verify]** `@effect/vitest@4.0.5` declares a peer dependency of `vitest >=5.0.0 <6.0.0`. Check which `vitest` version the project can use before scaffolding. `vitest` stays the only test runner; `@effect/vitest` is an extension of `vitest`, not a replacement.

### 1.12 Bundle size

- **[official]** The core `effect` package supports aggressive tree-shaking, and the project reports that a minimal program bundles to **7.1 kB (minified + gzipped)**. This is the maintainers' own figure.
- **[project]** Import named exports from `"effect"` (`import { Effect, Schema } from "effect"`), never the whole namespace object.
- **[project]** The desktop app's bundle size is deliberately not measured (decided 2026-10-22); the exported bots, which are Rust, are what matter for size.

### 1.13 Common mistakes

| Mistake | Instead |
|---|---|
| Following a v3 tutorial (`Effect.Service`, `Context.Tag`, `catchAll`, `@effect/schema`) | Use the v4 names in this section; read the types in `node_modules/effect` |
| Calling `Effect.runPromise` from many components | Run effects only in the bridge layer, through the single `ManagedRuntime` |
| `throw` inside `Effect.gen` | `return yield* new SomeTaggedError(...)` |
| Catching everything with `Effect.catch` early | Catch specific tags; keep the catch-all for the outermost boundary |
| Using `Service.use(...)` everywhere | `yield* Service` inside `Effect.gen` |
| Wrapping pure logic in `Effect` | Keep it as a plain function |
| Using `Date.now()` | Use `DateTime` / the `Clock`, so tests can control time |

### 1.14 Tooling that catches mistakes

- **[official]** The **Effect Language Service** (`@effect/language-service`) is a TypeScript language service plugin that adds Effect diagnostics, quick fixes, refactors and completions. The version checked is `0.87.5` (published 2026-10-16); its rule table has separate columns for Effect v3 and v4, and most rules apply to both.
- **[official]** The plugin loads only while editing, so a plain `tsc` run does not show its diagnostics. The CLI offers two ways: `effect-language-service patch` (modifies the local TypeScript installation) or `effect-language-service diagnostics --project <tsconfig>` (reports without patching).
- **[official]** For TypeScript 7.0 or newer the maintainers point to `@effect/tsgo` instead of this plugin.
- **[project]** Install it as a dev dependency, add it as the **last** entry of `compilerOptions.plugins` in `tsconfig.json`, and select the workspace TypeScript version in the editor (`js/ts.tsdk.path` in `.vscode/settings.json`).
- **[project]** Run `effect-language-service diagnostics --project <tsconfig>` from `cargo xtask lint` and in CI. Do **not** patch TypeScript, so `node_modules` stays untouched.
- **[project]** Severities: `outdatedApi` as `error` (it flags v3 names removed or renamed in v4); `tryCatchInEffectGen` and `leakingRequirements` as `warning`. Keep the default `error` for `floatingEffect`, `missingReturnYieldStar`, `missingEffectError` and `missingEffectContext`. Consider `strictEffectProvide` as `warning` to protect the single-runtime rule (1.7).
- **[project]** Keep the `global*` rules (`globalDate`, `globalConsole`, `globalFetch`, `globalRandom`, `globalTimers`) and `newPromise`, `preferSchemaOverJson` **off** for now: they report any use outside Effect generators, which would flag plain TypeScript that we deliberately keep plain (1.2). Revisit if they can be limited to the services folder.
- **[project]** Keep `importFromBarrel` **off**: it suggests specific module paths, while 1.12 asks for named imports from `"effect"`.
- **[verify]** Whether the plugin analyzes code inside `.svelte` files. The plugin's page only says to list it last among plugins. Effect code lives in `.ts` and `.svelte.ts` files, so this should not matter.
- **[verify]** Whether `svelte-check`, ESLint and the other tools work with TypeScript 7 before choosing the TypeScript version.
- **Not adopted:** `@effect/eslint-plugin` (last published 2025-04, before Effect 4; ESLint stays for Svelte and TypeScript style) and Effect DevTools (the v4 `devtools` module is marked unstable and compatibility of the VS Code extension with v4 was not confirmed). Revisit DevTools for debugging complex streams.

### Sources for section 1

- Effect Language Service repository and README: https://github.com/Effect-TS/language-service
- npm registry metadata for `@effect/language-service` and `@effect/eslint-plugin`, checked 2026-10-22.
- Effect repository, `LLMS.md` (official guidance for writing Effect code, v4): https://github.com/Effect-TS/effect/blob/main/LLMS.md
- Effect repository, v3 to v4 migration guide and its pages (`services.md`, `error-handling.md`, `runtime.md`, `schema.md`): https://github.com/Effect-TS/effect/blob/main/MIGRATION.md
- Effect repository, `ai-docs/src` examples (services, errors, `ManagedRuntime`, testing): https://github.com/Effect-TS/effect/tree/main/ai-docs/src
- npm registry, `effect@4.0.5` and `@effect/vitest@4.0.5` metadata and type declarations (stability tags, function signatures), checked 2026-10-22.
- Third-party guidance, used only where marked **[verify]**: community Effect guides listed on skills.cat and playbooks.com, and the `@barekey/svelte-effect-runtime` page on jsr.io.

---

## 2. TypeScript

Goal: strict types and a small set of flags, with no per-file loosening.

- **[official, from npm peer ranges checked 2026-10-22]** Pin `typescript` to `~6.0` (latest 6.x is `6.0.3`). npm `latest` is `7.0.2`, but `typescript-eslint@8.72.0` declares the peer range `typescript >=4.8.4 <6.1.0` and `svelte-check@4.7.7` declares `^5.0.0 || ^6.0.0`. Revisit when both support 7. The Effect Language Service also asks for `@effect/tsgo` on TypeScript 7 (see 1.14).
- **[official]** `"strict": true` enables `alwaysStrict`, `strictNullChecks`, `strictBindCallApply`, `strictBuiltinIteratorReturn`, `strictFunctionTypes`, `strictPropertyInitialization`, `noImplicitAny`, `noImplicitThis` and `useUnknownInCatchVariables`.
- **[official]** Four flags that are **not** part of `strict` and are worth adding: `noUncheckedIndexedAccess` (adds `undefined` to indexed reads), `exactOptionalPropertyTypes` (an optional property cannot be set to `undefined` explicitly), `noImplicitOverride`, and `noFallthroughCasesInSwitch`.
- **[verify]** `verbatimModuleSyntax: true` (forces `import type` for type-only imports). Svelte tooling is expected to require it; confirm when scaffolding with `sv`.
- **[project]** Those are all the compiler flags we set on purpose. Anything else needs a reason in the pull request.
- **[project]** Use `unknown` instead of `any`, and narrow it with `Schema` or the `Predicate` module (1.2). No `!` non-null assertions outside tests. Prefer discriminated unions with a `_tag` field, which matches Effect's tagged errors. Prefer string-literal unions over `enum`.

Linting is covered in section 5.

Sources: https://www.typescriptlang.org/tsconfig/ (the page was read only in part, so the flags above are the ones whose descriptions were read), npm registry peer ranges for `typescript-eslint` and `svelte-check`.

---

## 3. Svelte 5 and the Tauri frontend

All **[official]** rules below come from the Svelte documentation ("Best practices" and the `$effect` page).

**State and derived values**
- Always use runes mode in new code. Avoid the legacy features: `$:`, `export let`, `on:click`, `<slot>`, `<svelte:component>`, `<svelte:self>`, stores for shared reactivity (use classes with `$state` fields), `use:action` (use `{@attach}`), and the `class:` directive.
- Use `$state` only for values that drive an effect, a `$derived` or the template. Plain variables are fine for everything else.
- For large objects that are reassigned and not mutated (API responses, a loaded payload), use `$state.raw` to avoid the cost of deep proxies.
- Compute values with `$derived` (or `$derived.by` for multi-step logic), never with `$effect`. Derived expressions must have no side effects.
- Do not copy props into plain variables; derive from them, otherwise the value will not update.

**Effects**
- Treat `$effect` as a last resort. Alternatives: `{@attach}` for external libraries, event handlers or function bindings for user interaction, `$inspect` for debugging, `createSubscriber` for external sources.
- Do not update state inside an effect and do not chain effects to sync two states; if an effect loops because it reads and writes the same state, wrap the read in `untrack`.
- Return a teardown function to clean up. It runs before each re-run and on destroy.
- Dependencies are the reactive values read **synchronously** during the run. Values read after an `await` or inside `setTimeout` are not tracked.
- Never wrap effect contents in `if (browser)`.

**Template**
- Events are attributes: `onclick={...}`. Use `<svelte:window>` and `<svelte:document>` for global listeners, not `onMount` or `$effect`.
- Use snippets and `{@render}` instead of slots.
- Use keyed `each` blocks. The key must uniquely identify the item and must never be the index.
- Use `{#key}` sparingly: it remounts everything inside.
- Pass values to CSS with `style:--name={value}` and read them with `var(--name)`; let parents style children through custom properties and use `:global` only when nothing else works.

**Shared state**
- The documentation prefers **context** over shared module state, and `createContext` over `setContext`/`getContext` for type safety. Its reason is server-side rendering, where module state can leak between users.
- **[project]** We are a client-side app with no server rendering, so module-level stores in `.svelte.ts` files are allowed for app-wide singletons (settings, the Effect bridge). State that belongs to one open project or one editor instance goes in context.

**Node editor**
- **[official, npm]** `@xyflow/svelte@1.7.0` (published 2026-09-24) declares the peer dependency `svelte ^5.25.0`, so it targets Svelte 5.
- **[project]** Svelte Flow's `onlyRenderVisibleElements` (off by default; it renders only what is in the viewport but adds overhead) is for flows of hundreds of nodes; a typical bot is far below that, so leave it off until a measurement says otherwise. Keep custom node components simple.
- **[official]** Internationalization uses `@inlang/paraglide-js` with its Vite plugin (`paraglideVitePlugin({ project: "./project.inlang" })`, compiler options `outdir` and `emitTsDeclarations` in `project.inlang/paraglide.config.js`); messages are used as `m.name({ ... })` and the locale is read with `getLocale()` and set with `setLocale()`. With no server, the strategies `localStorage`, `preferredLanguage` and `baseLocale` apply (in that order).

**Tauri SPA**
- **[project]** The frontend is a static single-page app; the Svelte code never touches the filesystem or the network directly, only through `TauriBackend` (1.9).
- **[project]** Plain Vite + Svelte, not SvelteKit. **[official]** Tauri does not support server-based rendering and recommends Vite for single-page frameworks.
- **[project]** Translations use `paraglide-js`; every user-facing string goes through it.

Sources: https://svelte.dev/docs/svelte/best-practices, https://svelte.dev/docs/svelte/$effect, npm registry metadata for `@xyflow/svelte`.

---

## 4. Tailwind CSS v4 and `bits-ui`

**Tailwind v4**
- **[official]** Install `tailwindcss` and `@tailwindcss/vite`, add `tailwindcss()` to the plugins in `vite.config.ts`, and put `@import "tailwindcss";` in the main CSS file. The installation page shows no `tailwind.config.js`: configuration is CSS-first.
- **[official]** Tailwind finds classes by scanning your source files for class names and generating static CSS. Custom source paths are documented on its "Detecting classes in source files" page, which was not read.
- **[official, npm]** `@tailwindcss/vite@4.3.3` declares the peer range `vite ^5.2.0 || ^6 || ^7 || ^8`, so it works with the Vite 8 we use.
- **[verify]** Because Tailwind scans for literal class names, building class names by string concatenation is expected not to work. Use complete class names or `style:--name` variables.
- **[verify]** Design tokens, dark mode and theming are not researched yet.

**`bits-ui` and our own components**
- **[official]** `bits-ui` is a headless library for Svelte: components ship unstyled, with WAI-ARIA, keyboard navigation and focus management built in. You style them with `class` props or `data-*` attributes, and take control of the rendered element through the Child Snippet. `bits-ui@2.20.0` declares the peer range `svelte ^5.33.0`.
- **[project]** Our components live in one folder (for example `src/lib/components/ui/`) as thin wrappers around `bits-ui` primitives, each owning its styling. Application code imports our components, not `bits-ui` directly.
- **[project]** Do not re-implement behavior that `bits-ui` already provides (dialogs, menus, selects, tooltips, focus handling).

Sources: https://tailwindcss.com/docs/installation/using-vite, https://bits-ui.com/docs/introduction, npm registry metadata.

---

## 5. ESLint and Prettier for Svelte and TypeScript

- **[official]** `sv add eslint` installs the ESLint packages including `eslint-plugin-svelte`, creates `eslint.config.js`, updates `.vscode/extensions.json`, and configures ESLint to work with TypeScript and Prettier when they are present. The documentation does not show the generated file.
- **[project]** Run `sv add eslint` (and the Prettier add-on if offered) when scaffolding, review the result once, commit it, and then change it only to add what this guide asks for. Do not hand-write a long rule list.
- **[official]** For typescript-eslint, start from `recommendedTypeChecked` plus `stylisticTypeChecked` with `parserOptions.projectService: true`. The maintainers advise `strict` only if a good share of the developers are highly proficient in TypeScript, and say `strict` and `strict-type-checked` are not stable under semver. We start without them.
- **[official]** typescript-eslint has no formatting rules; formatting belongs to Prettier. ESLint therefore enforces correctness and Prettier enforces layout, and they do not overlap.
- **[project]** Accept Prettier's defaults. The `.prettierrc` only registers `prettier-plugin-svelte`. There is no style discussion about quotes, semicolons or line width.
- **[project]** Scripts in `package.json`: `lint` (ESLint), `format` (Prettier), `check` (`svelte-check`). `cargo xtask lint` calls them. There are no git hooks.
- **[official, npm]** Versions checked: `eslint@10.13.0` (needs Node `^20.19 || ^22.13 || >=24`), `typescript-eslint@8.72.0`, `eslint-plugin-svelte@3.23.1` (peer `eslint ^8.57 || ^9 || ^10`), `prettier@3.9.10`, `prettier-plugin-svelte@4.1.1` (peer `prettier ^3`, `svelte ^5`), `svelte-check@4.7.7`.
- **[verify]** The exact rules that `sv add eslint` generates for Svelte 5 have not been inspected.

Sources: https://svelte.dev/docs/cli/eslint, https://typescript-eslint.io/users/configs/, npm registry metadata.

---

## 6. Rust

Goal: modern, safe and minimal. Three configuration files carry the whole baseline: the root `Cargo.toml`, `deny.toml` and (by default) no `rustfmt.toml`.

**Workspace**
- **[official]** One root `Cargo.toml` with `[workspace]`. Share metadata with `[workspace.package]` (members opt in with `key.workspace = true`), dependency versions with `[workspace.dependencies]` (`dep.workspace = true`), and lints with `[workspace.lints]` (members add `[lints] workspace = true`, available since Rust 1.74).
- **[official]** In a virtual workspace set `resolver` explicitly; the Cargo documentation uses `resolver = "3"`. Set `rust-version` once in `[workspace.package]`.
- **[project]** Edition 2024; `rust-version` set to the oldest toolchain we actually test (1.99.0 at the time of writing).

```toml
# Cargo.toml (root), shape only
[workspace]
members = ["crates/*", "apps/desktop/src-tauri", "xtask"]
resolver = "3"

[workspace.package]
edition = "2024"
license = "MIT OR Apache-2.0"
rust-version = "1.99"

[workspace.lints.rust]
unsafe_code = "forbid"

[workspace.lints.clippy]
unwrap_used = "warn"
panic = "warn"
unimplemented = "warn"
dbg_macro = "warn"
todo = "warn"
```

**Lints**
- **[official]** `unsafe_code = "forbid"` is the Cargo documentation's own example of a workspace lint.
- **[official]** Clippy's default groups are the ones to follow: `correctness` is deny by default and should not be silenced; `style` is warn and opinionated. The `pedantic`, `restriction` and `nursery` groups are opt-in, and the Clippy documentation says **not** to enable `restriction` (or `nursery`) as a whole group but to cherry-pick lints. For `pedantic` it suggests cherry-picking too, and warns to expect many `#[allow]` attributes if you enable it entirely.
- **[project]** So: Clippy defaults plus five cherry-picked lints (`unwrap_used`, `panic`, `unimplemented`, `dbg_macro`, `todo`, as in the sketch above). CI runs `cargo clippy --workspace --all-targets -- -D warnings`.
- **[project]** `unwrap_used` is allowed in tests. In non-test code use `?` and typed errors, or `expect("reason")` only for an invariant that cannot fail, with the reason in the message.
- **[project]** **Never panic on untrusted input**. Anything that reads a project file, a payload, a Discord event, an expression result or user text returns an error. Check indices and sizes that come from input, use `get` instead of indexing where the input decides the position, and use checked arithmetic where input decides a size. A fix for a crash ships with a regression test; every node ships a test with bad input.
- **[project]** `rustfmt` with its defaults; no `rustfmt.toml`. CI runs `cargo fmt --check`.
- **[project]** `unsafe` is forbidden workspace-wide. A crate that truly needs it opts out of the workspace lint table with its own `[lints]` and justifies it in the pull request, with the `unsafe` block isolated and commented. Code inside C dependencies such as bundled SQLite is outside this rule.

**API design**
- **[official]** From the Rust API Guidelines checklist, the items that matter for `graph`, `runtime` and the `Platform` and `Storage` traits: derive common traits eagerly (`Debug`, `Clone`, `PartialEq`, `Default`, `Hash` where they make sense); implement `Debug` on all public types; make types `Send` and `Sync` where possible; make error types meaningful and well-behaved; validate function arguments; document errors, panics and safety; keep struct fields private. Internal crates can relax the future-proofing items.
- **[project]** Libraries use `thiserror` for error enums; binaries (`runner`, the Tauri app, `xtask`) use `anyhow`. Library crates do not depend on `anyhow`.

**Dependencies and supply chain**
- **[official]** `cargo-deny` checks four things on the dependency graph: advisories, bans, licenses and sources. `cargo deny init` creates a default configuration and `cargo deny check` runs everything. A GitHub Action exists (`EmbarkStudios/cargo-deny-action`).
- **[project]** Start from the file `cargo deny init` generates, allow only the licenses compatible with `MIT OR Apache-2.0`, and run `cargo deny check` in CI. This replaces separate `cargo-audit` runs, because its advisories check already covers vulnerable crates (**[verify]**: the RustSec database is the source of that check).
- **[project]** Commit `Cargo.lock`. Add a dependency only when the standard library or an existing dependency cannot do the job; the runner's size and RAM matter.


Sources: https://doc.rust-lang.org/clippy/lints.html, https://doc.rust-lang.org/cargo/reference/workspaces.html, https://rust-lang.github.io/api-guidelines/checklist.html, https://embarkstudios.github.io/cargo-deny/.

---

## 7. Tauri v2

**[official]** (Tauri security documentation)
- The trust boundary is the **IPC layer**: it is the only bridge between your Rust core and the frontend in the system WebView. Define and check all data that crosses it.
- Capabilities say which commands and plugin permissions each window can use. They live in `src-tauri/capabilities/` (JSON or TOML), one file per capability, referenced by identifier in `tauri.conf.json` (`app.security.capabilities`); once any are listed there, only those are used. A capability has an `identifier`, the `windows` it applies to (by **label**, not title), and a list of `permissions` such as `core:window:allow-set-title`.
- Grant the least privilege each window needs. A window covered by several capabilities gets the merged permissions. Expose window creation only to higher-privileged windows.
- By default **every command you register in Rust can be called from all windows**. To restrict this, configure `AppManifest::commands` in `build.rs`.
- Capabilities do not protect against insecure Rust code, overly broad scopes or bypasses written in the Rust core.
- **CSP is off unless you set it.** Set a policy that is as restrictive as possible, allow only hosts you trust (preferably your own), and avoid remote content such as scripts from a CDN. Tauri adds nonces and hashes to bundled code at compile time. Consider the **Isolation Pattern**.
- Tauri uses the operating system's WebView rather than bundling one, so OS and WebView maintainers deliver the security patches.

**[project]**
- The bot token never crosses IPC to the frontend and is never stored in a project file. The frontend can only ask Rust to start or stop a bot.
- Every Tauri command validates its inputs on the Rust side, treating the frontend as untrusted. Commands return typed errors that the frontend decodes (1.5, 1.9).
- One capability file per window, starting with a single main window and only the permissions it uses. Restrict command exposure in `build.rs`.
- A restrictive CSP from the first build: `default-src 'self'`, no remote scripts, and fonts and icons bundled with the app, not loaded from a CDN.
- Project folders are opened through the dialog plugin or file association, with access limited to the folder the user chose (**[verify]**: how scopes and file associations work for a project folder).

**Sidecar (the runner)**
- **[official]** Bundle an external binary with `bundle.externalBin` in `tauri.conf.json` (for example `"binaries/runner"`). The file must exist with the target triple appended, such as `src-tauri/binaries/runner-x86_64-unknown-linux-gnu`; `rustc --print host-tuple` gives the triple. Start it with `app.shell().sidecar("runner")` from `tauri-plugin-shell`, passing only the file name.
- **[official]** `tauri_plugin_shell::process::Command` supports `env`, `envs`, `env_clear`, `current_dir` and `args`; `spawn()` returns a receiver of `CommandEvent` (standard output arrives as raw bytes) and a child handle.
- **[project]** Call the plugin only from Rust and grant the webview no `shell:*` permission, so the frontend cannot start processes. Start the runner with `env_clear()` and only the variables it needs.
- **[verify]** Where the installed sidecar ends up in the AppImage and `.deb` packages and that it starts there; the pages read cover the bundling, not the installed layout.

**Types shared with the frontend**
- **[official]** `tauri-specta` for Tauri v2 generates TypeScript bindings from Rust. Annotate each command with `#[tauri::command]` and `#[specta::specta]`, register commands with `collect_commands![...]` and events with `collect_events![...]` (events derive `Event`), and export with `builder.export(Typescript::default(), "<path>")` from `specta-typescript`. The generated file exposes `commands.<name>` and `events.<name>`. Top-level `Channel<T>` arguments and return values are typed as `Channel<T>`. Large integers (BigInt) are forbidden by default.
- **[official]** `tauri-specta` v2 is **still in beta** (checked: `2.0.0-rc.26`, published 2026-10-21). Its documentation advises pinning exact versions with `=`. The three crates must be pinned as a set that resolves: `tauri-specta =2.0.0-rc.26` needs `specta =2.0.0-rc.26`, which `specta-typescript =0.0.13` accepts. The newest `specta` (`rc.27`) and `specta-typescript` (`0.0.14`) do not resolve together with it, so bump the three in one pull request. The `1.0.2` shown on crates.io is the Tauri v1 line and must not be used.
- **[project]** Pin `tauri-specta`, `specta` and `specta-typescript` with `=`. Export the bindings in debug builds (the documentation's example exports under `#[cfg(debug_assertions)]`), commit the generated file, and make CI regenerate it and fail if it differs from the committed one.
- **[project]** Use 64-bit integers carefully: either avoid them in shared types or convert them explicitly (for example Discord ids as strings), never with the option that casts BigInts to numbers.
- **[official]** A command that returns `Result<T, E>` with an error type deriving the specta type is generated as a function that resolves to `{ status: "ok", data } | { status: "error", error }`, so the frontend handles failures as values and not as exceptions; `Channel<T>` arguments are typed as `Channel<T>`. For live bot logs use a `Channel`: Tauri documents events as unsuited to ordered, high-volume data.

- **[project]** The CSP is `app.security.csp` in `tauri.conf.json`; `app.security.devCsp` replaces it under `tauri dev`, where Vite needs `'unsafe-inline'` styles and `ws://localhost:1420` and `http://localhost:1420` in `connect-src`. Checked in M0 under `tauri dev`: the window loads and the webview calls a command. The production policy is checked when the app is first packaged.
- **[project]** The commands the frontend may call are listed in `build.rs` (`AppManifest::commands`); each gets a permission named `allow-<command-with-dashes>`, which the capability file grants. A command that is not in both places cannot be called.

**[verify]**
- Keep the `tauri` crate and the `@tauri-apps/*` packages on the same minor version. Versions checked: `tauri 2.12.5`, `@tauri-apps/api 2.12.4`, `@tauri-apps/cli 2.12.4`.

Sources: https://v2.tauri.app/security/, https://v2.tauri.app/security/capabilities/, https://v2.tauri.app/security/csp/.

---

## 8. twilight

- **[official]** Version checked: `twilight 0.17.1` (published 2025-12-13); the repository is active (commits on 2026-10-20) and not archived.
- **[official]** `Shard` connects to the gateway, parses messages and **handles reconnecting, resuming and identifying** by itself. Create it with `Shard::new(ShardId::ONE, token, intents)` and read events with `shard.next_event(EventTypeFlags)` in a loop. On an `Err`, log it and continue. Events are delivered only while the loop is polling, so a slow handler delays the gateway; hand work to other tasks.
- **[official]** `next_event` takes `EventTypeFlags`, so the shard can **filter** which event types it parses and returns.
- **[official]** Features: TLS defaults to `rustls-native-roots`; compression can be `zlib` or `zstd`; `simd-json` is opt-in and requires `-C target-cpu=native`.
- **[project]** Pass only the `EventTypeFlags` that the bot's nodes use, computed together with the gateway intents. Do not enable `simd-json`: `target-cpu=native` produces binaries that may not run on other machines.
- **[official]** The in-memory cache is configured through `ResourceType` bitflags: `CHANNEL`, `EMOJI`, `GUILD`, `MEMBER`, `MESSAGE`, `PRESENCE`, `REACTION`, `ROLE`, `USER`, `USER_CURRENT`, `VOICE_STATE`, `STAGE_INSTANCE`, `INTEGRATION`, `STICKER` and `GUILD_SCHEDULED_EVENT`. The builder's `resource_types` method sets which are cached (**default: all**) and `message_cache_size` sets how many messages are kept per channel (**default: 100**). For example, enabling `CHANNEL` without `MESSAGE` caches channels but not their messages. This confirms that the cache can be limited to what the nodes use.
- **[project]** Build the cache with only the resource types the bot's nodes need, and set `message_cache_size` explicitly. A bot without nodes that need a cache runs without one.
- **[project]** Feed the cache with `cache.update(&event)` for every event received, before the node logic runs.

Sources: https://twilight.rs/chapter_1_crates/section_3_gateway.html, https://twilight.rs/chapter_1_crates/section_4_cache_inmemory.html, https://docs.rs/twilight-cache-inmemory/latest/twilight_cache_inmemory/struct.ResourceType.html, https://docs.rs/twilight-cache-inmemory/latest/twilight_cache_inmemory/struct.InMemoryCacheBuilder.html, GitHub and crates.io metadata.

---

## 9. SQLite with `rusqlite`

- **[official]** Version checked: `rusqlite 0.40.2` (published 2026-08-08).
- **[official]** Enable WAL with `PRAGMA journal_mode=WAL;`. The setting is stored in the database file, so it persists across connections. Readers and writers can work at the same time, and I/O is faster and more sequential.
- **[official]** WAL needs shared memory: all processes must run on the **same host**, and it does **not work over network filesystems**. It adds `-wal` and `-shm` files next to the database.
- **[official]** A checkpoint runs automatically when the WAL reaches 1000 pages (about 4 MB) and when the last connection closes. Long-running readers can prevent the WAL from being reset, so it grows without bound.
- **[official]** With `synchronous=NORMAL` in WAL mode, commits do not sync and a power loss or hard reset can roll back recent transactions; `FULL` syncs the WAL on every commit.
- **[project]** WAL on for bot storage. Document that a project or bot data folder must not live on a network drive.
- **[project]** `synchronous=FULL`: safer, and the extra write latency does not matter for small bot data. Revisit only if a measurement shows a problem.
- **[verify]** Settings to confirm against the SQLite documentation before use: `foreign_keys=ON`, `busy_timeout`, and the `cache_size` and `mmap_size` values for low RAM.
- **[verify]** `rusqlite`'s `bundled` feature (compiles SQLite with the crate); that `Connection` is `Send` but not `Sync`; and that blocking database calls from async code should go through `tokio::task::spawn_blocking` or one dedicated thread. Confirm each in the crate documentation.
- **[project]** The exported bot creates its database on first run in a `data/` folder next to the executable (resolved relative to the executable, overridable by an environment variable). It is never embedded in the executable. Local runs from the editor use `.botinventor/` inside the project, which is not committed.
- **[project]** Group multi-step writes in a transaction. All access goes through the `Storage` trait, so the rest of the runtime never sees SQL.

Sources: https://sqlite.org/wal.html, https://docs.rs/rusqlite/latest/rusqlite/ (the page read covers the basics only).

---

## 10. Testing across Rust and TypeScript

- Frontend Effect testing is in 1.11; frontend tests use `vitest` with `@effect/vitest` for Effect code.
- **[project]** Rust tests are run with `cargo nextest`, and each service trait (`Platform`, `Storage`) has an in-memory test implementation so logic is tested without the network or a database file.

---

## 11. Repository tooling and the minimal baseline

The quality baseline is deliberately small. These are the only configuration files that exist for quality checks; a new one needs a decision in `DECISIONS.md`.

| File | Purpose |
|---|---|
| `Cargo.toml` (root) | workspace metadata, shared dependencies, lint table (section 6) |
| `deny.toml` | `cargo-deny` configuration (section 6) |
| `tsconfig.json` | strict TypeScript flags and the Effect plugin (sections 1.14, 2) |
| `eslint.config.js` | generated by `sv add eslint`, plus typed linting (section 5) |
| `.prettierrc` | registers the Svelte plugin, nothing else (section 5) |
| `rust-toolchain.toml` | pins the Rust toolchain, with `rustfmt` and `clippy` |
| `.cargo/config.toml` | the `cargo xtask` alias, nothing else |
| `.nvmrc` | pins Node for developers and CI |
| `.prettierignore` | keeps Prettier out of `dist/` and `src-tauri/` |
| `pnpm-workspace.yaml`, `package.json` (root) | the JS workspace, the pinned `packageManager` and the `commitlint` rules |

What runs, through `cargo xtask lint` / `cargo xtask test`, on a developer machine and in CI:

| Area | Checks |
|---|---|
| Rust | `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo xtask layers` (the crate dependency rules of `ARCHITECTURE.md` §2), `cargo nextest run`, `cargo deny check` |
| TypeScript and Svelte | `prettier --check`, `eslint`, `svelte-check`, `effect-language-service diagnostics --project <tsconfig>`, `vitest run` |
| Commits | Conventional Commits, checked by `commitlint` in CI |

**Versions checked on 2026-10-22** (re-check when scaffolding):

| Tool | Version | Tool | Version |
|---|---|---|---|
| Rust / Cargo | 1.99.0 | `svelte` | 5.57.2 |
| Node | 26.12.0 | `vite` | 8.3.5 |
| pnpm | 12.14.0 | `@sveltejs/vite-plugin-svelte` | 7.3.1 |
| `typescript` | pin `~6.0` (6.0.3); `latest` is 7.0.2 | `vitest` | 5.0.5 |
| `eslint` | 10.13.0 | `tailwindcss` | 4.3.3 |
| `typescript-eslint` | 8.72.0 | `bits-ui` | 2.20.0 |
| `prettier` | 3.9.10 | `@xyflow/svelte` | 1.7.0 |
| `svelte-check` | 4.7.7 | `effect` | 4.0.5 |
| `tauri` (crate) | 2.12.5 | `tokio` | 1.54.1 |
| `twilight` | 0.17.1 | `rusqlite` | 0.40.2 |

Compatibility notes read from the packages' own metadata: `vitest@5.0.5` needs Node `^22.12 || ^24 || >=26` and accepts Vite 6.4, 7 or 8; `@effect/vitest@4.0.5` accepts `vitest >=5.0.0 <6.0.0`, which `5.0.5` satisfies; `@sveltejs/vite-plugin-svelte@7.3.1` needs Vite 8.

- **[project]** `pnpm`: `pnpm-lock.yaml` is committed, the package manager is pinned with the `packageManager` field, and CI installs with `--frozen-lockfile`.
- **[project]** Third-party GitHub Actions are pinned to a commit SHA, with the version in a comment. Update them in a dedicated pull request.

---

## 12. Expressions (CEL)

Decision: see *No code node; CEL expressions* in `DECISIONS.md`. Conditions and formulas in nodes are CEL; text templates are `{{ expression }}` segments evaluated with the same engine.

- **[official]** The CEL specification says programs are **side-effect-free** (they only compute an output from their inputs), **terminating** (they cannot loop forever) and **deterministic** for a given evaluation environment. The Rust crate describes CEL as non-Turing-complete and meant for lightweight evaluation where a fully sandboxed scripting language is too heavy.
- **[official]** `cel` 0.15.0 (MIT; published 2026-10-06; pre-1.0). Basic use: build an environment with `Env::stdlib()`, compile with `env.compile(source)`, create a `Context::with_env(env)`, register functions with `context.add_function(name, closure)`, and run with `program.execute(&context)`. Optional features pull in `regex`, `chrono`, `chrono-tz`, `base64`, `bytes` and `serde_json`.
- **[project]** Enable only the crate features the nodes need. Pin the minor version of `cel` and keep it behind the `ExpressionEngine` trait, since the crate is pre-1.0.
- **[project]** Functions registered in the context must be **pure**: no I/O, no clock, no randomness, no access to storage. Anything with a side effect is a node, not an expression function. This is what keeps CEL's guarantees true for our bots.
- **[project]** CEL ending is not the same as CEL being cheap. Cap the length of an expression's source and the size of values passed into a context (Discord already limits message sizes).
- **[project]** The editor checks an expression as the user types, using the same compilation step as the exporter, so a bot with an invalid expression cannot be exported.
- **[project]** Text templates: split the text on `{{ ... }}`, evaluate each segment as an expression, and convert the result to text. A template with no segments is plain text and costs nothing.
- **[official]** `Program::references()` returns the variables and functions an expression uses, so compile needs no tree walker of its own, and `Program` is `Send + Sync`. Build one base `Context::with_env(env)` and give each event a child with `new_inner_scope()`, which borrows the parent.

Sources: https://github.com/google/cel-spec (language definition), https://github.com/cel-rust/cel-rust, crates.io metadata for `cel`, and the size comparison in `DECISIONS.md`.
