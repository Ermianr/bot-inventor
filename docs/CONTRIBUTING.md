# Contributing to Bot Inventor

Thank you for helping. This guide explains how work is organized and what a pull request needs. Decisions behind these rules are in [`DECISIONS.md`](DECISIONS.md). The code rules are in [`../AGENTS.md`](../AGENTS.md) §2, which also gives orientation and the steps for picking work.

## 1. Before you start

- Read [`ROADMAP.md`](ROADMAP.md) (what the project does and does not plan), [`ARCHITECTURE.md`](ARCHITECTURE.md) and, for the language or tool you will touch, [`DEVELOPMENT-GUIDE.md`](DEVELOPMENT-GUIDE.md).
- The project priorities, in order, are **security**, **functionality**, then **performance and low memory**. Measure before optimizing.
- Everything written in the repository is in **English**: code comments, commits, pull requests, issues and documents.
- Be kind. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## 2. Set up

Linux is the supported platform for now.

- Rust (the toolchain is pinned by `rust-toolchain.toml`), Node and `pnpm` (versions pinned by the repository).
- Tauri's system libraries, for example `webkit2gtk-4.1`, `libsoup3`, `librsvg` and `patchelf` (see `TOOLING.md`).
- Nothing else is needed: tasks run through `cargo xtask`.

```
git clone https://github.com/Ermianr/bot-inventor.git
cd bot-inventor
pnpm install
cargo xtask lint && cargo xtask test
```

### Daily commands

| Command | What it does |
|---|---|
| `cargo xtask dev` | Run the app in development mode |
| `cargo xtask lint` | Format check, `clippy -D warnings`, `layers`, ESLint, Prettier, `svelte-check`, Effect diagnostics, `cargo-deny` |
| `cargo xtask test` | Rust tests (`nextest`), doc tests and `vitest` |
| `cargo xtask build` | Build the app, with the release runner bundled as its sidecar |
| `cargo xtask layers` | Check the crate dependency rules of `ARCHITECTURE.md` §2 |
| `cargo xtask bindings` | Regenerate the TypeScript types from Rust; `--check` fails if they differ from the committed ones (what CI runs) |
| `cargo xtask dump <file>` | Print a payload, or the payload at the end of an exported bot, as JSON |

`dev`, `build`, `lint`, `test` and `bindings` first build the runner and copy it to `apps/desktop/src-tauri/binaries/runner-<target triple>`, where Tauri expects the app's sidecar; the app crate does not compile without that file, so on a clean checkout run `cargo xtask test` (or `lint`) once before using `cargo` directly on it.

The app exports a bot from its menu (M12b). To write an exported folder by hand, compile a project and give the result to the exporter:

```sh
cargo build --release -p runner
cargo run -q -p runtime --example compile -- crates/graph/tests/samples/v1/ping /tmp/ping.payload
cargo run -q -p exporter --example export -- --runner target/release/runner \
  --payload /tmp/ping.payload --project crates/graph/tests/samples/v1/ping --out /tmp/ping-bot --name ping-bot
```

The first run installs the frontend dependencies and, if missing, `cargo-nextest` and `cargo-deny`, so Rust and `pnpm` are all you need besides Tauri's system libraries.

There are no git hooks: run the checks yourself; CI runs them on every pull request.

## 3. How to contribute

Planned work is in [`ROADMAP.md`](ROADMAP.md): the ordered list of **milestones** in section 2 and the node catalog in section 4 with their definitions of done. GitHub issues are for problems and proposals. Every change arrives as a small pull request that passes CI.

| Where | What |
|---|---|
| `docs/ROADMAP.md` | What exists or is planned, and the milestones to work on |
| **Issue** form | A bug, an error, a limitation, a missing test, technical debt, a documentation problem |
| **Proposal** form | A new feature or a larger change, before writing code |

Labels used: `accepted` (a maintainer agrees to a proposal), `in progress`, `needs info` (we asked the author for more and are waiting), `good first issue`, `help wanted`. They are created with the repository.

### 3.1 Contributors

1. **Bug or small fix.** Open an issue with the **Issue** form (or go straight to a pull request if the fix is obvious), then send a pull request that says `Closes #n`.
2. **New feature or larger change.** Open a **Proposal** *before* writing code: the problem, what you suggest, the alternatives, and whether you want to build it. A maintainer answers and, when the idea fits, marks it `accepted` and adds it to the roadmap. Pull requests for features nobody agreed to may be closed. A design change that alters a decision ends as a new entry in `DECISIONS.md`.
3. **Take planned work.** Pick a milestone that is `ready` in section 2 of the roadmap, or, once the recipe exists, a node row marked Next. Claim it by opening a **draft pull request** for it. You do not write a milestone yourself; a maintainer does.
4. **Work on a fork** (or a branch if you have write access). Keep the pull request small and about one thing.
5. **Open the pull request** from the template. Its title is a Conventional Commit (section 4). Describe what you ran to test it.
6. CI must be green. A maintainer reviews it and squash-merges it; the title becomes the commit on `main`.

Issues labeled `good first issue` are the place to start. Triage, reproducing bugs and improving documents also count as contributions.

### 3.2 Milestones

A **milestone** is a capability stage that can be tested end to end, even if it is internal (for example, "the runtime executes the Ping graph against the mock platform"), sized for one pull request, a few days. If it grows past about a week, it is split. Small pieces of work, such as one node, are the **node rows** of the roadmap.

1. A milestone is an entry in section 2 of the roadmap with a name, what it depends on and a definition of done. It becomes `ready` once its **acceptance criteria are written in full and agreed**, before starting (one checkbox each).
2. Work on it in a branch named `m5-short-title` and open one pull request, as a draft at the start.
3. The milestone is **done** when the pull request is merged and every criterion passes. The same pull request ticks the criteria, moves the entry to the done list and marks the node rows Done. It carries no known errors or technical debt (see 3.3).
4. A milestone that will not be done is changed to `dropped` in the roadmap with a line saying why. What was learned goes in the pull request description.

### 3.3 Problems found along the way

A milestone carries no known errors or technical debt.

- A defect that breaks one of the milestone's acceptance criteria is fixed **inside the milestone**, which is not finished until it is. (The same applies to your own pull request.)
- Anything else you find, whether in the area you are working on or not, is an ordinary **issue**: open one with the **Issue** form (what happens, what should happen, how to reproduce it, impact) and keep going. The pull request does not carry it, and the milestone does not list it. If a pull request fixes an issue, write `Closes #n` in it.
- Do not leave a problem only in a code comment or in your head.
- Security vulnerabilities are not issues: report them privately (see [`SECURITY.md`](SECURITY.md)).

## 4. Commits and pull request titles

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/). `release-plz` builds versions and the changelog from them.

```
feat(runtime): run the Ping graph against the mock platform
fix(graph): reject a flow with two triggers
docs: describe the payload footer
feat(graph)!: rename the variable scope field
```

- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- The scope is the crate or area (`graph`, `runtime`, `discord`, `storage`, `runner`, `desktop`, `editor`, `docs`), and is optional.
- **Mark a breaking change with `!` or a `BREAKING CHANGE:` footer.** A change to the project format, the payload or the behavior of a node is breaking. Before 1.0 a new feature raises only the patch number and a breaking change raises the minor number, so the mark is how the version tells the truth.
- A project-format or payload change also needs a migration and a sample file of the old version.

## 5. What a pull request needs

- Green CI: format, lint, tests, dependency checks, the layers check, no differences in generated bindings and the commit-message check.
- **The golden rules** in [`../AGENTS.md`](../AGENTS.md) §2: no secrets, no `unsafe` and no panic on untrusted input, the crate layers, validation in Rust, tests, few and justified dependencies.
- **Tests** for what changed: a flow test against `MockPlatform`, a migration test, a `vitest` test, whichever fits (`ARCHITECTURE.md` §11). A bug fix includes a test that failed before.
- **Docs:** if you change behavior, a decision or a format, update the matching document in the same pull request (`DECISIONS.md` for a decision).
- Keep the change to what the issue or the milestone says. Unrelated improvements go in their own pull request.

### Using AI tools

You may use AI tools. You are responsible for what you submit.

- Read, understand and test the code before you open the pull request, and say so in the description. A pull request that clearly was not reviewed by its author may be closed.
- Write your own replies to review comments (using a tool only to translate is fine).
- Coding agents working in this repository also follow [`../AGENTS.md`](../AGENTS.md).

## 6. Review and merging

While there is one maintainer, the maintainer's own pull requests are merged when CI is green; pull requests from other contributors are always reviewed by the maintainer. One approval will be required as soon as there is a second maintainer.

### Triage (maintainers)

- A bug report without enough to reproduce it gets the label `needs info` and a comment saying what is missing. With no answer after **14 days** it is closed, with a note that it can be reopened.
- An issue that mixes several problems or requests is answered with a request to split it, or is split by a maintainer; each part is tracked on its own.
- A report that is really a vulnerability is moved to private reporting (see [`SECURITY.md`](SECURITY.md)) and the public text is removed.
- Duplicates are closed with a link to the original.

## 7. License

By contributing you agree that your contribution is licensed under `MIT OR Apache-2.0`, as the rest of the project.

## 8. Recipes

Short step-by-step guides for the most common contributions, written from what was really done.

### Adding a node

A node is one file in `crates/runtime/src/nodes/` with its schema and its executor together. `branch.rs` is the smallest one; `reply.rs` is one that calls the platform.

1. **Declare the schema** as a `static SPEC: NodeSpec` (`catalog/mod.rs`): the type id (`discord.reply`) and `version` (1), the `fields` with their kind and limits (the limits that come from Discord are written here, once), the output `ports` (add `error` if the node can fail), the named `outputs` that later nodes read as `steps.<alias>.<output>`, what it `requires` (intents, cache) and, for a trigger, its `TriggerSpec`. Compile and the editor read this and nothing else.
2. **Write the executor** in the same file: `fn execute<P: Platform, S: Storage>(cx: &mut NodeCx<'_, P, S>) -> Result<Outcome, NodeError>`, `async` if it calls the platform. Read settings with `cx.text`, `cx.expression` and `cx.flag` (they return an error for a missing or wrong value); return `Outcome::next()` or `Outcome::port("true")`, with `outputs` when the node publishes values. A `NodeError` sends the run to the `error` port: use `NodeError::invalid` for a bad value, and let `?` convert `ExprError`, `PlatformError` and `StorageError`. A node that writes variables goes through `run::vars` (`store`, `add`), as `set_variable.rs` does. A message names the setting and never carries its value or text from a user.
3. **Register it** in `nodes/mod.rs`: `mod`, the schema in `builtin_specs`, and the variant of `Kind` with its lines in `ALL`, `spec` and `execute`. A test fails if a schema has no executor or the other way round.
4. **If it needs a new action**, add the method to the `Platform` trait (`platform/mod.rs`), a variant to `Action` and the recording to `MockPlatform`; the Discord side is `platform-discord`.
5. **Test it** in `crates/runtime/tests/`: a flow that uses it, run with `start` and `dispatch_and_wait` against `MockPlatform` (`tests/common/mod.rs` has the builders; `start_stored` takes a storage), and a test with bad input over a payload that skips compile (`run_bad_input.rs`): wrong types, missing settings and out-of-range values must fail the run cleanly, never panic. Compile tests for its schema go in the `compile_*` files.
6. **Update the docs**: the node row in `docs/ROADMAP.md`, and `docs/ARCHITECTURE.md` if the design changed.

### Other recipes (planned)

**Adding a Discord event or action**, and **changing the project format** (with its migration and sample), follow when those exist.
