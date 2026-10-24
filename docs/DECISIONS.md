# DECISIONS

The decisions that shape the project: the ones that change how it behaves or that would be expensive to redo. Tools, process and details live in the other documents; this file holds only what was decided and why.

## Export model

- **Decision.** A bot is exported as a prebuilt, GUI-less `runner` binary with the bot's compiled graph (the payload) appended. Local run uses the same binary: the app compiles the project to a payload file and starts the runner as a child process; the runner prints logs as JSON lines on standard output and the app forwards them to the interface through a Tauri `Channel`. Stopping sends a termination signal, then kills the process after a timeout.
- **Why.** No Rust toolchain on the user's machine, export takes seconds, and what is tested locally is exactly what is exported. A crash in the bot cannot take the app down, and the token exists only in the child's environment. The cost is one extra process (about 12 MiB in a minimal program).
- **Revisit if.** Users need native, non-extractable code per bot; keep the graph model clean so generating a Rust project stays possible. Rejected for now: generating Rust and running `cargo build` (a ~1 GB toolchain, minutes per export), and bundling a headless copy of the app (large, includes the webview).
- **How the app starts it.** The runner is bundled as a sidecar (`externalBin`, named with the target triple; Tauri puts it next to the app's executable) and started from Rust only, with `tokio::process`: the webview is granted no plugin permission at all, so only the app's Rust code can start processes. The child gets a cleared environment plus the four variables it needs. **Why not `tauri-plugin-shell` (M12a):** its child handle can only kill (`SIGKILL`), and a bot must get `SIGTERM` first to close the gateway and finish its runs; sending it needs a signal call, and `unsafe` is forbidden. `rustix` (already in the tree through `tokio` and `tauri`, `process` feature only) has a safe `kill_process`, so the plugin would have added a dependency and a permission surface for a spawn that `tokio` already does. Stopping is `SIGTERM`, then a kill after 10 seconds.
- **To verify.** That the sidecar starts from the installed `.deb` and the AppImage. Checked (M12a): both packages hold `runner` next to the app's executable, where the app looks; starting it from an installed app is M12c.
- **Details.** `ARCHITECTURE.md` §1, §9.

## Project and payload formats

- **Decision.** Two formats. The **project** is a folder: `bot.botproj` (a JSON manifest with a fixed name), `flows/*.flow.json` (scanned, not listed, so two people adding flows do not conflict), `assets/`, `.botinventor/` (local state, not committed) and a generated `.gitignore`. Files are JSON with a stable key order and stable node ids, saved through a temporary file and a rename. The **payload** is MessagePack compressed with zstd and carries only the logic. A compile step turns the first into the second: it validates, drops editor data and precomputes.
- **Versions.** The project has an integer `format_version`: the app migrates older projects when opening (after a backup copy) and refuses newer ones. The payload has its own integer version, checked by the runner. Every migration is tested against a sample of each version.
- **Payload versions.** A payload is built from the project each time a bot is run or exported, and the runner inside an export is the one that matches it, so the runner reads only the current payload version: a newer one says to update, an older one says to export the bot again. Each version keeps a sample payload, and a test requires one for every version. Until the first release, payload version 1 may still change (the nodes and the compile step are not built) and its sample is regenerated; from the first release a change to the payload is a new version, and the sample of the released one is kept as it is.
- **Why.** The runner does not depend on the editor's format; a project with errors cannot be exported; a folder allows assets and gives clean git diffs. MessagePack tolerates schema evolution, and the size savings of positional formats do not matter for a graph of kilobytes.
- **Note.** The payload is not encrypted: embedding it is packaging, not protection.
- **Compile output.** `compile` returns diagnostics with a stable code, the flow, the node id and the field path, and a payload only when there is no error; a warning (a step or an `error` value that exists on only some paths) does not block. The payload does not depend on the order of the nodes and lines in the files: nodes are written in a topological order that breaks ties by node id, so the same bot gives the same bytes. `CommandDef::hash` is the SHA-256 of the command definition with its keys in order (`sha2`, small and without default features), so the runner can compare it with the stored one and send only the commands that changed.
- **Details.** `ARCHITECTURE.md` §3.

## Exported bot layout

- **Decision.** An exported bot embeds only its logic. `.env`, `assets/` and the SQLite `data/` stay outside, next to the executable. Directories resolve relative to the executable, not the working directory, with environment variables to override them. Asset names resolve only inside the assets directory (`..` and absolute paths are rejected), and at startup the runner checks that every referenced asset exists.
- **Why.** The database holds state that changes while the bot runs, and testing data must not ship; `.env` holds secrets; not bundling assets keeps the executable small and lets a user change an image without exporting again.
- **Exporting again.** The folder is meant to be exported into again, so the exporter replaces only what it writes (the executable, `.env.example` and the project's asset files) and keeps `.env`, `data/` and anything else, and it never leaves a half-written export (it stages, then renames). The executable is replaced by rename, never written in place, so a running bot does not block it.
- **Cost.** An exported bot is a folder, not a single file. Optional embedding of assets can be added later.
- **To verify.** Directory resolution under systemd and containers.
- **Details.** `ARCHITECTURE.md` §9.4.

## No code node; CEL expressions

- **Decision.** Bots are strictly no-code. Conditions and formulas are written in CEL, run by the `cel` crate behind an `ExpressionEngine` trait. Text is a template: plain text with `{{ expression }}` segments evaluated by the same engine. Expressions are stored as source and parsed once at startup, and also checked at compile time. Registered functions are pure (no I/O, clock or randomness). Text written by Discord users is inserted as data and never evaluated.
- **Why.** CEL programs are side-effect-free, always terminate and are deterministic by specification, so safety does not depend on limits we must remember to set. Rhai is smaller (+1.7 MiB against +4.2 MiB for CEL in a minimal runner) but Turing-complete; `evalexpr` is AGPL-3.0, incompatible with our license; `minijinja` adds loops and macros a no-code bot does not need. Peak memory was the same for all.
- **Revisit if.** Users need logic CEL cannot express (then consider Rhai, or WebAssembly for real sandboxing), or the pre-1.0 `cel` crate becomes a problem; the trait boundary and a pinned minor version limit the damage.
- **Checked.** `cel` 0.15 exposes `Program::references()` (the variables and functions an expression uses), `Program` is `Send + Sync`, and a base `Context` can be built once and borrowed per event with `new_inner_scope()`.
- **Verified (M3).** `cel` is pinned to `=0.15.0` with `default-features = false`: no `regex`, `chrono` or `ext_encoders`, no extension libraries and no optional values. That keeps 36 crates in the runtime's tree against 47 with the defaults, and leaves out the time zone database and a regex engine; the conditions of Welcome and Moderation (roles, permissions, text and number comparisons, `has`, the list macros) need none of them. Only a closed list of operators and functions may be called. When a bot needs more (`matches`, case-insensitive comparison), add it to the list on purpose, after checking that it is pure and what it costs. Because `Program::references()` returns only root names and counts macro variables as names, the engine walks the syntax tree itself to list full paths (`event.user.id`) and to refuse unknown names.
- **Verified (M11a).** The condition builder does not change the format: a project stores the text of the expression, the builder is a view that reads back only the shapes it can write, and everything else stays in the advanced mode. Renaming a node rewrites `steps.<alias>` by parsing, but the positions `cel` keeps are off by one inside a macro such as `has()`, so the places are found in the token stream and the syntax tree decides whether the rewrite is right (the result must parse to the original tree with only the reads of the old alias renamed); a field that fails that check is left as it is. A macro variable named `steps` is the case it cannot tell apart, and it is refused. Typed text is always written as an escaped literal, never spliced into the expression.
- **Details.** `ARCHITECTURE.md` §6, `DEVELOPMENT-GUIDE.md` §12.

## Graph model and variables

- **Decision.** Lines between nodes define execution order only. Data is not wired: each node exposes named outputs that later nodes read by name (`steps.<alias>.<output>`), in fields or expressions. Every node has a unique, renamable alias; renaming makes the editor rewrite the expressions that use it by parsing them. A flow is acyclic; repetition is a structured node with a maximum count.
- **Variables** are declared in the project with a name, a type (integer, decimal, text, boolean), a scope and an initial value, and are read as `vars.<scope>.<name>`. The builder chooses the scope per variable: `run`, `bot`, `server`, `member` (server + user) or `user` (global); all but `run` persist. Writes go through the *Set variable* node; counters are an atomic operation.
- **Why.** Fewer cables and a simpler canvas for people who do not program, matching `{{ }}` templates. Acyclic flows plus CEL mean a run always ends. Declared variables let the condition builder offer them in lists, let compile check types and spelling, and let the database know what to expect.
- **Cost.** Changing a variable's type later needs care: on a mismatch the runner refuses to start with a message that names the variable. Integer to decimal converts by itself (no data is lost); any other change needs the explicit command `runner --reset-variable <scope>.<name>`, which deletes the stored values of that variable. Data is never lost silently.
- **Details.** `ARCHITECTURE.md` §4.

## Node definitions

- **Decision.** Each node type is declared once, in Rust, in `runtime`: its fields with types and limits, ports and named outputs, the intents and permissions it needs, and its executor. The editor receives the schema and draws the property panel from it; compile validates with the same schema. Roles, channels and members are chosen by pasting an ID into a validated field; a dropdown that asks Discord is a later option.
- **Why.** A new node is a change in one place; limits that come from Discord are written once; the editor needs no connection to Discord or the token.
- **Details.** `ARCHITECTURE.md` §5.2.

## Run model and Discord behavior

- **Decision.**
  - Every event starts an independent run (a tokio task) in parallel, with a global cap on simultaneous runs and limits on steps and time per run. Provisional values, to be adjusted by measurement: 64 simultaneous runs, 500 steps and 60 seconds per run, and 10 seconds of waiting on shutdown.
  - Discord requires a first response within 3 seconds: after 2 seconds without one the runtime defers by itself (`Platform::defer`, so it is tested without a network), using the visibility (public or ephemeral) set on the command node.
  - A run that fails with no error path logs the detail and replies with a generic ephemeral message with no internal data.
  - Messages sent by the bot ping nobody by default; a node option enables user or role mentions.
  - Slash commands are registered globally; if the project's `.env` defines a development server, local runs register there. At startup the runner compares its commands with the registered ones, field by field and not by a stored hash (so a command edited in the Developer Portal is put back), and sends only differences (Discord allows 200 command creations a day per server).
  - Intents and cache resources are derived from the nodes in use.
  - Inside a run, a node runs once, after every node before it that runs (lowest index first, in the topological order of the payload), so a node where two paths join sees the steps of both.
- **Why.** Parallel runs keep one slow node from blocking a server; the generic error keeps internals private; the mention default stops user text from triggering `@everyone`.
- **To verify.** The numeric defaults; that deferral keeps the chosen visibility (row 6 and 7 of `DISCORD-TEST.md`).
- **Details.** `ARCHITECTURE.md` §5, §7.

## Platform and storage abstractions

- **Decision.** Discord is reached through a `Platform` trait implemented on `twilight`. Persistent data goes through a `Storage` trait implemented on SQLite (`rusqlite`, bundled), in WAL mode with `synchronous=FULL`, on a dedicated thread.
- **Why.** `twilight` is modular and its cache can be limited per resource type, which fits the low-memory priority and the intents derived from nodes; the cost is more glue code than `serenity`. SQLite lets bots run queries (a leaderboard with `ORDER BY ... LIMIT`) that a key-value store forces into memory; the cost is C code and 1–2 MB in the runner. `FULL` confirms every commit on disk, so a crash or power cut loses nothing, and bot data is small and written rarely.
- **Checked (M6).** `Storage` is generic like `Platform` (`Runtime<P, S = MemoryStorage>`). `rusqlite` 0.40 is used with `default-features = false` and `bundled`, which leaves out its statement cache and its wasm backend. The atomic counter is the `add` operation of *Set variable*, not a node of its own. A value is stored under the type its variable was recorded with (a foreign key from the values to `variable_types` and a write that names its type), so the database itself refuses a value of another type; a type with nothing stored changes without a reset; an integer converts to a decimal exactly up to 2^53. A migration copies the database with `VACUUM INTO`, which also folds in the write-ahead log. `error.kind` has a fifth value, `storage`, whose message never carries the detail of the database.
- **Checked (M7).** `platform-discord` uses `twilight-gateway`, `twilight-http`, `twilight-model` and `twilight-cache-inmemory` at 0.17.1 with their default features, plus `rustls` with only `ring`: the twilight crates leave the TLS crypto provider to the application and panic on the first request without one (found by the tests of the requests). `ring` was chosen over `aws-lc-rs` because it is smaller and needs no `cmake`; its `ISC` license is added to `deny.toml`. `tokio` gets `macros` for `select!` in the gateway loop. The requests are tested against a fake HTTP server that the twilight client reaches through its proxy setting, so routes, bodies and the mapping of a 403 are checked without Discord. The first message after a deferral edits `@original` instead of relying on a follow-up replacing "thinking", so the behavior is the documented one. The result of creating a response has no message in twilight 0.17, so `message_id` costs one `GET` of the original message; a failure of that request leaves the id empty and does not fail a reply that was sent. The `hash` of a command in the payload is not used by the diff.
- **Revisit if.** A benchmark against `serenity` or a measurement of write latency shows a real problem; the traits keep both reversible. `redb` is the alternative if queries are never needed.
- **Details.** `ARCHITECTURE.md` §7, §8.

## Security baseline

- **Decision.** Priorities in order: security, then functionality, then performance and low memory. No optimization without a measurement, and no fixed numeric budgets.
  - **The bot token** lives only in the project's `.env` (mode 0600), written by the app from a field and read by the runner. It never goes into project files, payloads, git, logs, command-line arguments or the webview; the frontend can only learn whether one is set. There is no `keyring`.
  - `unsafe` is forbidden workspace-wide. Project files, payloads, Discord events, expression results and user text produce errors, never panics (Clippy rejects `unwrap`, `panic`, `todo` and `dbg!` in non-test code; every node has a bad-input test).
  - Every Tauri command validates its input in Rust, with least-privilege capabilities and a restrictive CSP.
  - The architecture rules between crates are enforced in CI (`cargo xtask layers`).
- **Why.** Bots hold a credential and run on text from strangers. `.env` is the mechanism the exported bot uses too, so local and exported modes do not differ, and a system keyring depends on a service that may not exist on Linux.
- **Cost.** The token is plain text on the user's disk; the documentation says so.
- **Details.** `ARCHITECTURE.md` §10, `DEVELOPMENT-GUIDE.md`.

## Rust owns the types and the validation

- **Decision.** Rust is the source of truth for data types. TypeScript types for Tauri commands and events are generated from Rust with `tauri-specta`, and CI fails if the committed bindings differ. The `graph` crate loads and validates projects; the frontend never parses a project file and receives validated structures. Effect `Schema` is used only for values that originate in the frontend.
- **Why.** One definition and one validator for the project format avoid drift between Rust and TypeScript and keep the frontend small.
- **Risk.** `tauri-specta` for Tauri v2 is in beta; `tauri-specta`, `specta` and `specta-typescript` are pinned together with exact versions. Fallback: hand-written `Schema` definitions plus contract tests on JSON produced by Rust.
- **To verify.** Error typing in the generated bindings and the CI regeneration check.
- **How (M10a).** `graph` and `runtime` derive `specta::Type` behind an optional `specta` feature that only `apps/desktop` enables, so the runner and the layer rules are untouched. Bindings are exported with `disable_serde_phases`, so each type has one TypeScript shape instead of a `_Serialize` and a `_Deserialize` copy. `specta` refuses 64-bit integers, so the `settings` and `initial` JSON values, the editor positions and the limits of a schema are typed with a stand-in through `specta(type = ...)`. The open project's folder never leaves Rust: the commands show a native folder dialog (`tauri-plugin-dialog`, used only from Rust and with no permission for the webview) and the webview sends the project, not a path. The webview holds the project and its undo history; Rust loads, saves and validates it.

## Frontend stack

- **Decision.** A Svelte 5 single-page app built with Vite (not SvelteKit: Tauri does not support server rendering and the app has few views). The node canvas is Svelte Flow. Effect 4 owns the boundaries and I/O (Tauri calls, streams, retries); components and pure helpers stay plain, and Effect does not run in exported bots. TypeScript is pinned to `~6.0` until `typescript-eslint` and `svelte-check` support 7. Expressions are edited with CodeMirror 6, used directly. The UI is internationalized from the start with `paraglide-js`, English only at first.
- **Verified (M11b).** CodeMirror 6 breaks the production CSP (`style-src 'self'`) because it writes its styles into a `<style>` element in the document; the end-to-end tests, which serve the built app with the real CSP, reported it. It is mounted in a shadow root, where it adopts a constructed stylesheet instead, so the CSP keeps no `unsafe-inline` and needs no nonce; custom properties and fonts still reach it. It has no history of its own, so `Ctrl+Z` is the history of the project everywhere. It is loaded on demand as its own chunk. The condition builder is offered for fields of kind `Condition` (an expression that gives true or false), not for every expression, so the panel needs no code per node type.
- **Why.** Retrofitting i18n into a finished UI is expensive. CodeMirror is modular and light (about 2 MB against about 100 MB for Monaco). Effect gives typed errors and resource handling at the boundaries and one validation library.
- **Cost.** There is no Svelte binding for Effect, so a small bridge is our own code.
- **To verify.** Effect's runtime lifecycle and hot reload in Svelte/Vite; Svelte Flow with large graphs; how `paraglide-js` plugs into the Vite setup.
- **Editor state (M10b).** The open project is an immutable value held by the frontend; an edit builds a new one, so the undo history (`editor/history.ts`, pure TypeScript) keeps snapshots by reference, at most 200, one history for every flow. Edits in a row to the same field of the same node are one step (a selection change or a save closes the step), and a drag of several nodes is one. "Unsaved" compares the project with the last opened or saved one by value, so an undo back to it shows "Saved". Rust still validates: the editor asks `validate_project` after 300 ms without changes and drops an answer about a project that has since changed. `Ctrl+Z` always acts on the project, also inside a text field, so there is one undo and not two.
- **Details.** `DEVELOPMENT-GUIDE.md` §1–§4, `TOOLING.md`.

## Platforms and signing

- **Decision.** Development, CI and export target Linux first. A bot is exported only for the system the app runs on. Windows and macOS (CI matrix, installers, cross-export, code signing) wait until there is something consolidated, and platform-specific code stays behind small modules. The project never signs the bots users export. App signing is deferred: Windows through SignPath Foundation when the repository is public, macOS unsigned at first with the "Open Anyway" step documented, Linux none.
- **Why.** Signing user-built code with the project's identity is not acceptable, and most bots are expected to run on Linux servers.
- **To verify (when Windows/macOS arrive).** Whether arm64 macOS binaries need an ad-hoc signature and an appended payload invalidates a signature (if so, the exporter signs ad-hoc after embedding the payload on macOS targets); how an appended payload interacts with Authenticode; SmartScreen warnings for downloaded bots on Windows.

## License and contributions

- **Decision.** `MIT OR Apache-2.0`. A contribution is licensed under the same terms as the project.
- **Why.** It is the Rust convention and satisfies SignPath's open source requirement; with the same license in and out, nothing has to be administered in advance.
- **Exported bots.** What the tool produces belongs to the user. The embedded runner carries its own license, and the third-party notice is generated with `cargo-about` or `cargo-deny`.

## Versioning

- **Decision.** One SemVer version for the whole workspace, so the runner embedded in an exported bot always matches the app that exported it. It starts at `0.1.0` and stays `0.y.z` until the maintainer decides to publish `1.0.0`, with no target date. `release-plz` runs on Conventional Commits with its default rules: a breaking change (`!` or a `BREAKING CHANGE:` footer) bumps the minor number and a feature only the patch, so changes to the project format, the payload or a node's behavior must be marked breaking. Compatibility is guarded by the integer format and payload versions, not by the app version.
- **Later.** Each node type may carry its own version so a node can change without breaking old projects.

## Identity

- **Decision.** The product is **Bot Inventor**. The repository is `github.com/Ermianr/bot-inventor` and the Tauri application identifier is `io.github.ermianr.bot-inventor`. Environment variables follow the Discord convention for the token (`DISCORD_TOKEN`) and use the prefix `BOT_INVENTOR_` for the rest (`ARCHITECTURE.md` §9.1).
- **Why fixed now.** Changing the identifier later changes the app's data directory and bundle id; the name is used in crates, packages and paths.

## Open

- **Contact for conduct reports.** The code of conduct still says `TODO`. The decision is to leave it until there is a community; then choose a dedicated address (not the maintainer's personal one) and add a fallback for reports about a maintainer (GitHub's abuse report form).

## Things to check while building

Verification items are listed in each decision above and marked `[verify]` in `DEVELOPMENT-GUIDE.md`. Also pending: file association of `.botproj` and Tauri file scopes on Linux.
