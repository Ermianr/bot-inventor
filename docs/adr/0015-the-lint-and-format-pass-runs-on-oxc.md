# The lint and format pass runs on oxc

Biome formatted this repository and ran its general lint pass; ESLint was installed for exactly one rule set. That pass now runs on the oxc toolchain — `oxfmt` for formatting and its sorting assists, `oxlint` for the lint pass — and Biome is gone. ESLint stays, unchanged and for the same one rule set.

The reason of record is convergence and capability, in that order. The rest of the build already runs on oxc's neighbours — Vite 8 and Rolldown — and the lint and format pass was the piece that had not moved. On top of that, three things the repository wanted are things Biome could not give it: Tailwind classes sorted against the project's **real** v4 stylesheet rather than a hard-coded default, so that the `@theme` block and the custom utilities in `packages/ui` are visible to the sorter at all; Vitest rules that exist natively rather than arriving through dependency detection; and an open path to type-aware linting, which Biome's `types` domain does not lead anywhere near.

**Speed is not the reason.** Nobody was waiting on `bun run check`, no measurement was taken, and none was needed: had oxc been slower, the capability argument would still have carried the change. Saying so here is a defence against the decision being remembered as a performance change and re-argued on performance grounds.

**Class canonicalization is not delivered.** `mt-[16px]` does not become `mt-4`, and it will not: the option does not exist in oxfmt ([oxc-project/oxc#22537](https://github.com/oxc-project/oxc/issues/22537) is open and unimplemented), does not exist in `prettier-plugin-tailwindcss`, and did not exist in Biome. It is a Tailwind CSS IntelliSense feature and, in lint form, an ESLint-only one. Nothing in this stack does it, so arriving expecting it is arriving disappointed.

The rules that run are chosen rather than inherited. `correctness`, `suspicious` and `perf` are errors; `pedantic`, `restriction` and `nursery` stay off; and `style` is not enabled wholesale — the ten `style` rules the team had picked by hand while Biome ran this pass are named one by one, so an agreed-upon set of enforcement survives the swap without importing hundreds of decisions nobody made. The translation was manual, because there is no official Biome-to-oxlint migrator, and it is the part of this change most likely to need revisiting.

## Why ESLint is still installed

ESLint carries `eslint-plugin-react-hooks`, which carries the React Compiler's diagnostics. This repository does not write memoization by hand ([ADR 0013](./0013-memoization-is-no-longer-written-by-hand.md)), which makes those diagnostics the thing that keeps the compiler's assumptions honest — they are not a style preference, they are the check that the code the compiler is trusted to memoize is code it can memoize.

The evaluation that kept ESLint alive is worth preserving, because it is the kind of work a future contributor will otherwise redo. Biome did grow a rule of its own, `useReactCompiler` in 2.5.8, and it was run against the same code on the same day as the plugin: it found **three of the seven breaches** the plugin found. It was in the nursery group, and it skipped itself entirely unless the nearest `package.json` named a React version it could parse — which `"react": "catalog:"` is not. A check that turns itself off in silence is worse than no check.

oxlint has React Compiler rules of its own, and they are experimental in the same way. **ESLint's retirement is gated on a measurement that has not been performed**: oxlint's rules run against the same code as the plugin, and the plugin goes only if the findings match. Until that number exists, two linters coexist and the second command is the price.

## Why type-aware linting is out of scope

Type-aware linting is the largest capability oxlint offers and the one this change does not take. It runs on a TypeScript 7 tool chain, and there is no TypeScript 6 path to it. The workspace catalogue pins TypeScript 6.

Upgrading that major is not a lint decision. It pulls in every `check-types` task, the Vite build and the Tauri build, and doing it in the same change as a linter swap would make any breakage ambiguous — a type error after that commit could belong to either half. So the capability waits, and the constraint is written here rather than rediscovered: what blocks type-aware linting is a TypeScript major upgrade that has to be decided on its own merits.

## Consequences

- **The undeclared-environment-variable rule is gone.** Biome's Turborepo domain flagged an environment variable read in source but not declared in `turbo.json`, and oxlint has no equivalent. A variable that is missing from the task's `env` will now be caught by a stale cache producing a wrong build rather than by the lint pass, which is a worse way to find out.
- **Dependency auto-detection is replaced by explicit wiring.** oxlint inspects nothing about the dependency list, so every plugin the repository needs is named in `.oxlintrc.json`. Adding a library whose lint rules matter is now a configuration change and not something that starts working on its own. Playwright, which has no native plugin, runs the upstream ESLint plugin through oxlint's JavaScript-plugin support — an alpha feature — scoped by glob to `apps/web/e2e` so its complaints never reach application code.
- **Named specifiers inside braces are no longer sorted.** oxfmt sorts import declarations; Biome's organize-imports assist sorted the names inside the braces too. The gap is accepted and must not be patched with a rule from the other linter: splitting one responsibility across two tools is the thing this change exists to stop doing.
- **The formatter is pre-1.0.** oxfmt's remaining published work is finishing its Prettier port, so an upgrade may move the output. A reformat that appears after bumping the version is beta churn, not a regression, and the response is a new blame-ignore revision rather than an investigation.
- **`bun run check` still means what it meant.** It rewrites files, now as the formatter followed by the linter with fixes applied. `bun run check:ci` answers the same question without touching anything and exits non-zero on any finding, so a complaint cannot be printed and scrolled past.
- **Two commands remain, and the second one has a condition attached.** `bun run check-react-rules` is ESLint and only ESLint. It goes when the measurement above says it can, and not before.
