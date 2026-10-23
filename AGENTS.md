# AGENTS.md: guide for AI agents and contributors

Orientation and working rules for anyone, person or coding agent, who works on Bot Inventor. How to contribute (issues, proposals, milestones, commits, what a pull request needs) is in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md); this file does not repeat it, it adds where to start, the code rules (the golden rules), how to pick work, and how to finish a task. Decisions behind both are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

Bot Inventor is an open source desktop application (Rust, Tauri v2, Svelte 5) to build bots **without code** from a node editor. The first platform is Discord. The app edits and compiles projects; a headless `runner` executes them, both for local runs and for exported bots.

## 1. Orientation

| Read | For |
|---|---|
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | The rules and the flow: set up, issues, proposals, milestones, commits, what a pull request needs, recipes |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What exists or is planned; section 2 is the ordered list of milestones to work on, with their definitions of done |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Crates, formats, graph model, execution, storage, security |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | The decisions that shape the project, with their reasons. Check it before changing a design; edit it when you change one |
| [`docs/DEVELOPMENT-GUIDE.md`](docs/DEVELOPMENT-GUIDE.md) | Practices for Rust, TypeScript, Svelte, Effect, Tauri, twilight, `rusqlite` |
| [`docs/TOOLING.md`](docs/TOOLING.md) | The tools and why |
| [`docs/SECURITY.md`](docs/SECURITY.md) | What counts as a security problem, and how to report one |

Priorities, in order: **security**, **functionality**, then **performance and low memory**. Measure before optimizing.

## 2. Golden rules

These are the code rules of the project, written once, here. Technical detail for each technology is in [`docs/DEVELOPMENT-GUIDE.md`](docs/DEVELOPMENT-GUIDE.md); a pull request that breaks one will not be merged.

1. **English** for code, comments, commits, pull requests, issues and documents. A conversation with the user may be in another language.
2. **No secrets.** The bot token lives only in a project's `.env` (mode 0600). Never put one in code, tests, fixtures, logs, screenshots, command-line arguments or the frontend, and redact it from output.
3. **No `unsafe`, and never panic on untrusted input.** Project files, payloads, Discord events, expression results and user text produce errors. Clippy rejects `unwrap`, `panic`, `unimplemented`, `todo` and `dbg!` in non-test code; `expect` is allowed only for an invariant that cannot fail, with the reason in its message.
4. **Respect the layers.** `graph` depends on nothing in the repo; `runtime` does not know Tauri, Discord or SQLite; only `apps/desktop` knows the GUI (`docs/ARCHITECTURE.md` §2). `cargo xtask layers` must pass, and a new crate is registered with its layer.
5. **Validate in Rust.** Every Tauri command validates its input, with least-privilege capabilities. Text written by Discord users is data and is never evaluated as an expression or template.
6. **One node, one place.** A node's schema and executor live together in `runtime`, and every node has a test with bad input: it must return an error, never panic.
7. **Effect only at the frontend boundaries** (Tauri calls, I/O, streams); components and pure helpers stay plain. TypeScript is pinned to `~6.0`.
8. **Tests are part of the change.** A bug fix has a test that failed before; a format or payload change has a migration and a sample of the old version.
9. **Few dependencies, each justified** in the pull request (what it replaces, its license, its size), passing `cargo-deny`. The runner stays small. No `evalexpr` (AGPL-3.0). `tauri-specta`, `specta` and `specta-typescript` are pinned together with exact versions. No git hooks.

## 3. Picking work

1. Read `docs/ROADMAP.md`: the current focus (section 3), then the milestones (section 2). Take the first milestone whose status is `ready` and that nobody is working on. Claim it with a draft pull request.
2. A milestone that is only `draft` has a sketch of its definition of done, not agreed criteria: do not start it. Ask the user, or propose the criteria first.
3. Do that milestone and nothing more. A problem found along the way that is outside its criteria is a separate issue (what happens, what should happen, how to reproduce), not part of your change. A defect against the criteria is fixed in the milestone.
4. Do not mark a milestone done while a known defect against its criteria remains.
5. Do not reopen a decision without a reason: read it in `docs/DECISIONS.md` first.

## 4. Before you finish

```sh
cargo xtask lint        # fmt, clippy -D warnings, layers, eslint, prettier, svelte-check, effect diagnostics, cargo-deny
cargo xtask test        # nextest and vitest
cargo xtask bindings    # regenerate the TypeScript types; commit any difference
```

Then update what your change affects, in the same pull request: the milestone and the node rows in `docs/ROADMAP.md`, `docs/DECISIONS.md` for a decision, `docs/ARCHITECTURE.md` for a design change.

## 5. Commits and pull requests

- Work in a branch named `m5-short-title`. Never push to `main`.
- Conventional Commit messages, with `!` for a breaking change (`docs/CONTRIBUTING.md` §4).
- If you wrote a significant part, a `Co-Authored-By` trailer is welcome.
- Open the pull request from the template and say what you ran to test it.
- Do not attach a harmful project or payload to a public issue (`docs/SECURITY.md`).
