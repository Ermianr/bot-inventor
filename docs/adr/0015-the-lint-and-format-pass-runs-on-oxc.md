# The lint and format pass runs on oxc

Biome formatted this repository and ran its general lint pass; ESLint was installed for exactly one rule set. That pass now runs on the oxc toolchain — `oxfmt` for formatting and its sorting assists, `oxlint` for the lint pass — and Biome is gone. ESLint stays, unchanged and for the same one rule set.

The reason of record is convergence and capability, in that order. The rest of the build already runs on oxc's neighbours — Vite 8 and Rolldown — and the lint and format pass was the piece that had not moved. On top of that, three things the repository wanted are things Biome could not give it: Tailwind classes sorted against the project's **real** v4 stylesheet rather than a hard-coded default, so that the `@theme` block and the custom utilities in `packages/ui` are visible to the sorter at all; Vitest rules that exist natively rather than arriving through dependency detection; and an open path to type-aware linting, which Biome's `types` domain does not lead anywhere near.

**Speed is not the reason.** Nobody was waiting on `bun run check`, no measurement was taken, and none was needed: had oxc been slower, the capability argument would still have carried the change. Saying so here is a defence against the decision being remembered as a performance change and re-argued on performance grounds.

**Class canonicalization is not delivered.** `mt-[16px]` does not become `mt-4`, and it will not: the option does not exist in oxfmt ([oxc-project/oxc#22537](https://github.com/oxc-project/oxc/issues/22537) is open and unimplemented), does not exist in `prettier-plugin-tailwindcss`, and did not exist in Biome. It is a Tailwind CSS IntelliSense feature and, in lint form, an ESLint-only one. Nothing in this stack does it, so arriving expecting it is arriving disappointed.

The rules that run are chosen rather than inherited. `correctness`, `suspicious` and `perf` are errors; `pedantic`, `restriction` and `nursery` stay off; and `style` is not enabled wholesale — the ten `style` rules the team had picked by hand while Biome ran this pass are named one by one, so an agreed-upon set of enforcement survives the swap without importing hundreds of decisions nobody made. The translation was manual, because there is no official Biome-to-oxlint migrator, and it is the part of this change most likely to need revisiting.

## Why ESLint is still installed

ESLint carries `eslint-plugin-react-hooks`, which carries the React Compiler's diagnostics. This repository does not write memoization by hand ([ADR 0013](./0013-memoization-is-no-longer-written-by-hand.md)), which makes those diagnostics the thing that keeps the compiler's assumptions honest — they are not a style preference, they are the check that the code the compiler is trusted to memoize is code it can memoize.

The evaluation that kept ESLint alive is worth preserving, because it is the kind of work a future contributor will otherwise redo. Biome did grow a rule of its own, `useReactCompiler` in 2.5.8, and it was run against the same code on the same day as the plugin: it found **three of the seven breaches** the plugin found. It was in the nursery group, and it skipped itself entirely unless the nearest `package.json` named a React version it could parse — which `"react": "catalog:"` is not. A check that turns itself off in silence is worse than no check.

oxlint has React Compiler rules of its own, and they are experimental in the same way. ESLint's retirement was gated on running them against the same code as the plugin and matching the findings. That measurement has now been made, and it is the section below.

## The measurement, and what it decided

The retirement gate above has now been run. Both checkers were pointed at the same two source directories — `apps/web/src` and `packages/ui/src` — and at the same probe file, and their findings were compared site by site rather than counted.

Over the repository's real source both are silent: ESLint lints 127 files and reports nothing, and oxlint's React Compiler rules over the same two directories report nothing either. That agreement measures nothing on its own, which is why the comparison was made against a probe: a single file holding one deliberate breach for each rule in `eslint-plugin-react-hooks`' recommended set. ESLint found thirteen. Every one of the thirteen is also found by oxlint **under the configuration this repository already ships** — no rule had to be added to `.oxlintrc.json` to reach parity.

| Probe | ESLint | oxlint |
| --- | --- | --- |
| Hook called inside a condition | `rules-of-hooks` | `react/hooks` |
| `setState` during render | `set-state-in-render` | `react/set-state-in-render` |
| `setState` in an effect | `set-state-in-effect` | `react/set-state-in-effect` (+ `no-deriving-state-in-effects`) |
| `Date.now()` during render | `purity` | `react/purity` |
| Module-scope variable reassigned in render | `globals` | `react/globals` |
| `ref.current` read during render | `refs` | `react/refs` |
| `useMemo` missing a dependency | `exhaustive-deps` | `react-hooks/exhaustive-deps` |
| Component declared during render | `static-components` | `react/static-components` |
| JSX constructed inside `try`/`catch` | `error-boundaries` | `react/error-boundaries` |
| `useCallback` missing a dependency | `exhaustive-deps` | `react-hooks/exhaustive-deps` |
| Derived state written from an effect | `set-state-in-effect` | `react/set-state-in-effect` (+ `no-deriving-state-in-effects`) |
| `useEffect` missing a dependency | `exhaustive-deps` | `react-hooks/exhaustive-deps` |
| Second derived-state effect | `set-state-in-effect` | `react/set-state-in-effect` (+ `no-deriving-state-in-effects`) |
| Array prop mutated during render | *not reported* | *not reported* |
| `useMemo` callback with an implicit `undefined` | *not reported* | *not reported* |
| Lowercase function called through a capitalized binding | *not reported* | *not reported* |

Thirteen of thirteen, and the two checkers also agree on the three probes neither of them catches. oxlint additionally reports what ESLint does not — `exhaustive-effect-dependencies`, `no-deriving-state-in-effects` and `no-unstable-nested-components` on the probe, and on real source `todo`, `rule-suppression` and extra-dependency findings from rules outside the recommended set. This is not a comparison result to celebrate; it is the reason the retirement is a change of its own rather than a deletion, because those extra rules have to be looked at before they are inherited.

**One thing ESLint reports that oxlint does not, and it is not a rule.** `.oxlintrc.json` lists `**/packages/ui` in `ignorePatterns`, so oxlint does not lint the UI package at all — dropping the probe there produces `No files found to lint` from oxlint and the full thirteen findings from ESLint. ESLint's flat config covers `packages/ui/src` deliberately, because that is where the shadcn components live and they are compiled by the React Compiler like everything else. Retiring ESLint without removing that ignore pattern would silently uncover half the component code. This is a configuration difference, not a capability one, but it is the thing most likely to be missed, so it is written down here rather than left to the diff.

Two rules in the plugin's recommended set have no oxlint counterpart at all: `config` and `gating`. Neither has anything to check here — this repository has no React Compiler configuration comment and no feature gate — so their absence costs nothing today and would cost something the day either is introduced.

**The decision is to retire ESLint**, and the conditions the retirement change must satisfy are the three above: `**/packages/ui` leaves `ignorePatterns`, the recommended set is named explicitly in `.oxlintrc.json` rather than left to whichever category currently happens to carry each rule, and the rules oxlint adds beyond the recommended set are decided on rather than inherited. `bun run check-react-rules` goes with it, and `bun run check` becomes the whole of the lint answer.

## Why type-aware linting is out of scope

Type-aware linting is the largest capability oxlint offers and the one this change does not take. It runs on a TypeScript 7 tool chain, and there is no TypeScript 6 path to it. The workspace catalogue pins TypeScript 6.

Upgrading that major is not a lint decision. It pulls in every `check-types` task, the Vite build and the Tauri build, and doing it in the same change as a linter swap would make any breakage ambiguous — a type error after that commit could belong to either half. So the capability waits, and the constraint is written here rather than rediscovered: what blocks type-aware linting is a TypeScript major upgrade that has to be decided on its own merits.

## Consequences

- **The undeclared-environment-variable rule is gone.** Biome's Turborepo domain flagged an environment variable read in source but not declared in `turbo.json`, and oxlint has no equivalent. A variable that is missing from the task's `env` will now be caught by a stale cache producing a wrong build rather than by the lint pass, which is a worse way to find out.
- **Dependency auto-detection is replaced by explicit wiring.** oxlint inspects nothing about the dependency list, so every plugin the repository needs is named in `.oxlintrc.json`. Adding a library whose lint rules matter is now a configuration change and not something that starts working on its own. Playwright, which has no native plugin, runs the upstream ESLint plugin through oxlint's JavaScript-plugin support — an alpha feature — scoped by glob to `apps/web/e2e` so its complaints never reach application code.
- **Named specifiers inside braces are no longer sorted.** oxfmt sorts import declarations; Biome's organize-imports assist sorted the names inside the braces too. The gap is accepted and must not be patched with a rule from the other linter: splitting one responsibility across two tools is the thing this change exists to stop doing.
- **The formatter is pre-1.0.** oxfmt's remaining published work is finishing its Prettier port, so an upgrade may move the output. A reformat that appears after bumping the version is beta churn, not a regression, and the response is a new blame-ignore revision rather than an investigation.
- **`bun run check` still means what it meant.** It rewrites files, now as the formatter followed by the linter with fixes applied. `bun run check:ci` answers the same question without touching anything and exits non-zero on any finding, so a complaint cannot be printed and scrolled past.
- **Two commands remain, and the second one is now on its way out.** `bun run check-react-rules` is ESLint and only ESLint. The measurement above says it can go, so it goes in the change that satisfies the three conditions that measurement attached to it.
