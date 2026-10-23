# TOOLING

The tools the project uses, one line each. How to use each one well is in [`DEVELOPMENT-GUIDE.md`](DEVELOPMENT-GUIDE.md), where the versions checked are also listed (§11). The reasons behind the choices that are expensive to change are in [`DECISIONS.md`](DECISIONS.md); the shape of the system is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Backend

| Area | Tool | Note |
|---|---|---|
| Language | Rust, edition 2024 | Stable toolchain pinned by `rust-toolchain.toml`, with `rustfmt` and `clippy` |
| Desktop shell | Tauri v2 | Plugins as needed: `dialog`, `opener`; `updater` later |
| Async runtime | `tokio` | Required by `twilight` and `reqwest` |
| Discord | `twilight` (`gateway`, `http`, `model`, `cache-inmemory`) | Behind the `Platform` trait |
| Expressions | `cel` | Behind the `ExpressionEngine` trait |
| Storage | `rusqlite` (`bundled`) | Behind the `Storage` trait |
| Serialization | `serde`, `serde_json`; `rmp-serde` and `zstd` for the payload | |
| HTTP client | `reqwest` with `rustls` | Only for the *HTTP request* node, later; `rustls` avoids system OpenSSL |
| Errors | `thiserror` in libraries, `anyhow` in binaries | |
| Logging | `tracing`, `tracing-subscriber` | The runner prints JSON lines |
| Types for the frontend | `tauri-specta`, `specta`, `specta-typescript` | Pinned together with exact versions |

## Frontend

| Area | Tool | Note |
|---|---|---|
| Language | TypeScript, `strict`, pinned to `~6.0` | `typescript-eslint` and `svelte-check` do not support 7 yet |
| Framework | Svelte 5 (runes) with Vite | Single-page app |
| Node canvas | Svelte Flow (`@xyflow/svelte`) | |
| Styles | Tailwind CSS v4 | With `@tailwindcss/vite` |
| Components | `bits-ui` plus our own | No `shadcn-svelte` |
| Effects and I/O | `effect` 4, `@effect/vitest` | Pinned to the same exact version; frontend boundaries only |
| Expression editor | CodeMirror 6 | Used directly, without a wrapper |
| Icons | `@lucide/svelte` | |
| i18n | `@inlang/paraglide-js` | |
| Package manager | `pnpm` workspaces | |

## Quality and testing

| Area | Tool | Note |
|---|---|---|
| Rust format and lint | `rustfmt`; `clippy` with `-D warnings` | The lint table forbids `unwrap`, `panic`, `unimplemented`, `todo` and `dbg!` outside tests |
| Crate layers | `cargo xtask layers` | Fails on a dependency between crates that the rules forbid |
| Rust tests | `cargo nextest`, doc tests, `insta` (snapshots), `proptest` (validator) | |
| Fuzzing | `cargo-fuzz` | Project loader, payload decoder, expression parser; later, on a schedule |
| Dependencies | `cargo-deny` | Advisories, bans, licenses, sources; run in CI |
| Coverage | `cargo-llvm-cov` | Informational, not blocking |
| Frontend lint and format | ESLint with `eslint-plugin-svelte`; Prettier with `prettier-plugin-svelte`; `svelte-check` | Svelte's recommended configurations |
| Frontend tests | `vitest` | A component-testing helper is added only if needed |
| Effect checks | `@effect/language-service` | Editor plugin and `effect-language-service diagnostics` in lint and CI; TypeScript is not patched |
| Commits | `commitlint` in CI | Conventional Commits |
| End-to-end | `tauri-driver` (WebDriver) | Few tests, critical flows only; later |
| Tasks | `cargo xtask` | `dev`, `test`, `lint`, `build`, `layers`, `bindings`; frontend-only tasks are `pnpm` scripts |
| Reproducibility | `Cargo.lock`, `pnpm-lock.yaml`; `packageManager` field; `mise` or `.nvmrc` | |

There are no git hooks: checks run on demand and in CI.

## Build, CI and release

| Area | Tool | Note |
|---|---|---|
| CI | GitHub Actions | Linux only for now |
| Cache | `Swatinem/rust-cache`, pnpm cache | |
| App packaging | `tauri build` with `tauri-apps/tauri-action` | AppImage, `.deb`, `.rpm` first |
| Versions and changelog | `release-plz` with `git-cliff` | Default rules, Conventional Commits |
| Runner build profile | `lto = "fat"`, `codegen-units = 1`, `strip = true`, `panic = "abort"`, `opt-level` `"s"` or `3` | Chosen by measurement |
| Cross-compilation | `cargo-zigbuild` or `cross` | Later, with cross-export |
| Auto-update | `tauri-plugin-updater` | Later |
| Documentation site | `mdBook` | When the repository is public |

## Development environment

- Rust with `rust-analyzer`, any editor with LSP support, Node, `pnpm`.
- Tauri's system libraries on Linux: `webkit2gtk-4.1`, `libsoup3`, `librsvg`, `patchelf`. On Arch: `webkit2gtk-4.1`, `base-devel`, `openssl`, `appmenu-gtk-module`, `librsvg`.
- Tauri CLI: `cargo install tauri-cli --locked`, or `@tauri-apps/cli` through `pnpm`.
- Useful but optional: `cargo-nextest`, `bacon` or `cargo-watch`, `cargo-expand`, `mise`.
