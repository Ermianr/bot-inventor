# ARCHITECTURE

How Bot Inventor is built: the shape of the system and how its parts work. The decisions behind it are in [`DECISIONS.md`](DECISIONS.md), the tools in [`TOOLING.md`](TOOLING.md), and the coding practices in [`DEVELOPMENT-GUIDE.md`](DEVELOPMENT-GUIDE.md).

Tags used below (anything untagged follows from `DECISIONS.md`):

- **[proposed]** a design that follows from the decisions but has not been confirmed on its own; it is changed freely in the milestone that builds it.
- **[verify]** something to check against the real tool when it is first used.

The names of fields, commands and environment variables below are working names. The milestone that creates each one fixes the final name and updates this file.

---

## 1. Overview

```
 ┌───────────────────────────── desktop app (Tauri) ─────────────────────────────┐
 │  Svelte editor  ◄── typed commands, Channel ──►  Rust backend                  │
 │  (canvas, panels,                                 ├─ project I/O (graph)       │
 │   condition builder)                              ├─ node catalog + validation │
 │                                                   ├─ compile  project → payload│
 │                                                   └─ run supervisor ──────┐    │
 └───────────────────────────────────────────────────────────────────────────┼────┘
                                                                             │ starts, reads stdout (JSON lines)
                                                                             ▼
   export (exporter)  ───── copies ─────►   runner  (headless binary)
   runner + payload + assets                 ├─ reads payload (embedded or --payload)
                                             ├─ runtime (dispatcher, runs, expressions)
                                             ├─ platform-discord (twilight)
                                             └─ storage-sqlite (rusqlite)
```

- The **app** edits projects, validates and compiles them, and supervises local runs. It never talks to Discord and never sees the bot token.
- The **runner** is the only thing that executes a bot. Local run and exported bot use the same binary and the same code path.
- A **project** (folder, editable, JSON) is compiled into a **payload** (compact, read-only, what the runner executes).

## 2. Crates and dependency rules

| Crate | Responsibility | Depends on (inside the repo) |
|---|---|---|
| `graph` | Data only: the types of the project and of the payload, their versions, migrations, load/save of the `.botproj` folder, payload encoding | nothing |
| `runtime` | The node catalog (schema + execution of every node), validation, compile (project → payload), the expression engine behind `ExpressionEngine`, the dispatcher and run executor, the `Platform` and `Storage` traits, a `MockPlatform` and in-memory storage for tests | `graph` |
| `platform-discord` | The `Platform` implementation on twilight: gateway, HTTP, cache, command registration | `runtime` (traits) |
| `storage-sqlite` | The `Storage` implementation on `rusqlite`: schema, migrations, a dedicated thread | `runtime` (traits, and the `graph` types it re-exports) |
| `exporter` | Packaging: copy the runner, append the payload, copy assets, write `.env.example` | `graph` |
| `runner` | The binary: reads its payload, reads `.env`, wires the runtime to Discord and SQLite, handles signals | `graph`, `runtime`, `platform-discord`, `storage-sqlite` |
| `apps/desktop` | The Tauri app: commands, run supervisor, the Svelte frontend | `graph`, `runtime`, `exporter` |
| `xtask` | Development tasks and CI checks | none |

Layout of the repository:

```
bot-inventor/
├─ Cargo.toml              # Rust workspace
├─ pnpm-workspace.yaml     # JS workspace
├─ rust-toolchain.toml
├─ crates/
│  ├─ graph/  runtime/  platform-discord/  storage-sqlite/  exporter/  runner/
├─ xtask/                  # cargo xtask
├─ apps/desktop/           # Tauri (src-tauri/) + frontend (src/)
├─ docs/
└─ .github/
```

Rules:

1. `graph` depends on nothing else in the repo.
2. `runtime` does not know Tauri, Discord or SQLite; it only sees the `Platform` and `Storage` traits.
3. Only `apps/desktop` knows the GUI. The runner does not link a webview; the app does not link twilight or `rusqlite`.
4. The app uses `runtime` for the node catalog, validation and compile, not to run bots.
5. `runner` may use `exporter` in its tests only (a dev-dependency), for the end-to-end test of an exported bot; it never links it. Each layer lists such crates in `dev_may_use` in `xtask/src/layers.rs`.

These rules are enforced, not just written: `cargo xtask layers` reads each crate's dependencies and fails the CI on any that breaks them. A new crate is registered with its layer when it is created.

## 3. Project and payload

### 3.1 Project (what the user edits)

```
my-bot/
├─ bot.botproj          # JSON manifest
├─ flows/*.flow.json    # one file per command, event or subgraph
├─ assets/
├─ .env                 # the token; ignored by git, mode 0600
├─ .botinventor/        # editor state, compiled payload, local data; not committed
└─ .gitignore           # generated
```

- `bot.botproj` holds: `format_version` (integer, 1 or more), `name`, `platform` (`discord`), `settings` (an object whose keys are not fixed yet) and `variables`, the **variable declarations** (`name`, `type`, `scope`, `initial`). It does not list flows; the app scans `flows/`.
- Each `flows/<name>.flow.json` holds one flow, and the flow name is the file name. Its fields are `nodes` and `lines`. A node has `id`, `alias`, `type`, `type_version`, `settings` (an object) and `editor` (`x` and `y`, the position, kept apart from the logic). A line has `from` (`node` and `port`) and `to` (a node id). The node `type` and `settings` are opaque to the `graph` crate; the node catalog in `runtime` gives them a meaning.
- Names are checked when the file is read: node ids are 1-64 letters, digits, `_` or `-`; flow names are 1-64 lowercase letters, digits, `_` or `-`, starting with a letter or a digit; aliases, port names and variable names are 1-64 lowercase letters, digits or `_`, not starting with a digit. A field that is not in the format is an error within the same `format_version`.
- Loading checks only the **shape** of the files (JSON, types, names, sizes); the graph itself (unique ids and aliases, ports, one trigger, cycles, references) is checked when it is compiled (§3.3). Loading never writes.
- Loading refuses a file larger than 4 MiB, a project with more than 256 flows, and any symbolic link or non-regular file it would read (`bot.botproj`, `flows/` and each flow file). A file in `flows/` that does not end in `.flow.json` (a leftover `.tmp`, for example) is ignored. The limits are provisional **[measure]**.
- Files are written with a stable key order (the declared order for fixed fields, sorted keys inside the free-form `settings`), pretty-printed with a final newline, through a temporary file and a rename. Saving creates `.gitignore` only if it is missing, removes the files of flows that no longer exist, and never touches `.env`, `assets/` or `.botinventor/`. Versioning and migrations are in *Project and payload formats* in `DECISIONS.md`.
- A project in an older format version is migrated in memory, as JSON, by a table of steps (`graph::migrate::STEPS`, empty while version 1 is the only one); the loader reports the version it came from. The backup copy made before the project is saved in the new version is written with the first real migration.

### 3.2 Payload (what the runner executes)

MessagePack (with field names) compressed with zstd and its content checksum. It carries only logic: no positions, comments or groups. The types are `graph::Payload` and the codec is `Payload::encode` and `Payload::decode`. Contents:

- the payload version (integer) and the app version that produced it;
- for each flow: its name, the index of its trigger and its nodes in an array; each node has its id, alias, type, type version, settings, expression sources and its lines as index adjacency (output port to node indexes), so there are no name lookups at run time;
- the **expression sources** as text, with the path of the setting that holds each one, parsed once when the runner starts (the AST is not stored);
- a table from event kind to the flows that start with it (indexes);
- the **command definitions** to register, with the flow that handles each and a hash of the definition;
- the variable declarations;
- the computed requirements: Discord intents, which cache resources are needed, the assets that are referenced.

What the codec guarantees (the limits are provisional **[measure]**):

- The same payload always gives the same bytes. Settings are written with sorted keys.
- Decoding reads the version first. Only the current version is read: a newer one is refused with a message that says to update, an older one with a message that says to export the bot again (a payload is built from the project each time a bot is run or exported, so it has no migration). The runner exits with code 3 for either (§9.3).
- Decoding checks that every index (a line target, a trigger, an event or command flow) points inside its list, and refuses more than 16 MiB compressed, more than 64 MiB decompressed, a zstd window above 64 MiB and MessagePack nested deeper than 128 levels. Encoding refuses what decoding would refuse.
- A damaged payload is caught by the zstd checksum; a truncated one by the zstd frame.

Container when exported: `[runner executable][payload bytes][footer]`. The footer has a fixed size of 20 bytes: the magic `BOTINVPL`, the container version (`u32`) and the payload length (`u64`), the numbers in little-endian. The runner reads the end of its own executable to find the payload (`graph::read_container`; a file with no footer returns nothing, and the runner uses `--payload <file>` for local runs). A footer with a newer container version, or a length larger than the file or the limit, is an error. The runner has `--dump`, which prints the payload as JSON (`graph::dump_json`); `cargo xtask dump <file>` does the same during development.

### 3.3 Compile (project → payload)

`runtime::compile::compile(&Project, app_version)` returns a `Report`; `compile_with` takes the node catalog and the expression engine too, for tests. The same function serves the editor, which shows the diagnostics, and the export, which needs the payload. A `Report` has the **diagnostics** in a fixed order (flow, node, field, code), the **payload** (only when there is no error) and the **variables each node reads**. A diagnostic has a severity, a stable code (`Code`, written in kebab case: `unknown-port`), the flow, the node id, the **field path** (`content`, `options[0].name`, or `lines[2]` for a line) and a message. A message names the field and the limit and never carries the value of a setting. Only an error stops the payload; a warning does not. A bot with errors cannot be exported.

The project arrives loaded and migrated (`Project::load`). In order:

1. **Variables:** `scope.name` is unique, and `initial` matches the type (an integer is accepted for a decimal).
2. **Structure,** per flow: node ids are unique, aliases are unique inside a flow, the type and `type_version` have a schema, lines join existing nodes and a port the type declares, no line enters the trigger, no line is repeated, there is exactly one trigger, every node is reachable from it and there is **no cycle**. A flow over 2048 nodes or 8192 lines is refused **[measure]**. All the passes are iterative, so the depth of a flow does not use the stack.
3. **Settings:** each node's settings are checked against its schema (`catalog::NodeSpec`): required and unknown fields, types, text length, number range, closed lists of words, asset paths that stay inside `assets/`.
4. **Expressions:** every expression field is compiled with the expression engine and a template field with `Template`; then each reference is resolved: `event.*` against the fields of the trigger (for a slash command, also `event.options.<name>` for each declared option), `steps.<alias>.<output>` against the alias and the outputs the node type declares, `vars.<scope>.<name>` against the declarations, `error.kind` and `error.message` against the `error` ports. A step that runs before the node on every path is valid; on only some paths it is a **warning**; on none (a node after it, a sibling branch, the node itself) it is an error. The same three cases apply to `error.*`: a node reached from an `error` port on every path, some, or none. The order is decided with dominators on the acyclic graph. When a flow has a structure error the order is not known and these checks are skipped; the others still run.
5. **Discord limits** (section 7), for each node that defines a slash command: name and description lengths, characters allowed in a name, up to 25 options, option names unique, required options first, 8000 characters in all, a command name unique across flows, at most 100 commands.
6. **Requirements:** the union of the intents and cache resources the nodes in use declare, and the assets they reference, each sorted and without duplicates; the variables each node reads, from its references.
7. **Emit the payload:** nodes in a canonical topological order (the trigger first, ties broken by node id), lines as sorted indexes by port, the event table, the command definitions and the variables. A template with no `{{ }}` segment is plain text and is not stored as an expression. The command `hash` is the SHA-256, in hexadecimal, of the definition as JSON with the keys in order. The order of the nodes and lines in the files does not change the payload bytes. `Payload::check` runs last.

## 4. Graph model

### 4.1 Nodes, ports, lines

- A **node** has: an opaque `id` (stable, created by the editor), a human `alias` (unique inside its flow), a `type` (for example `discord.slash_command`), a `type_version` (integer, starts at 1; it lets a node change without breaking old projects), and its `settings`.
- A node has one implicit input and one or more named **output ports** declared by its type: most have `next`; a branch has `true` and `false`; any node that can fail also has `error`; a loop has `each` and `done`.
- A **line** connects an output port to a node. Lines mean execution order only. Data is never wired.
- A **trigger** node has no input. Each flow has exactly one trigger.
- A flow is a **directed acyclic graph**. Repetition is a structured node whose body runs once per item with a maximum count (a *Later*-state node, see `ROADMAP.md`).

### 4.2 Reading data

Data is read by name in settings and expressions, in these namespaces **[proposed]**:

| Name | Meaning |
|---|---|
| `event.*` | Fields of the event that started the run. The fields depend on the trigger (`event.user.id`, `event.options.reason`, …). Discord ids are **text**, not numbers, to avoid precision and sign mistakes |
| `steps.<alias>.<output>` | Named outputs of nodes that already ran in this run |
| `vars.<scope>.<name>` | Declared variables; scope is `run`, `bot`, `server`, `member` or `user` |
| `error.kind`, `error.message` | Only on an `error` path: what failed |

- The **visual condition builder** (milestones M11a and M11b in `ROADMAP.md`) lists exactly these names. The user picks from lists; the builder writes the CEL expression; an advanced mode shows it in CodeMirror.
  - **The project stores only the text** of the expression. The builder is a view of it: `runtime::condition::Condition` (rows joined by *all* or *any*; a comparison, a text test, a membership or a presence test, each with names and typed values) is written with `to_source` and read back with `from_source`, which returns nothing for an expression of any other shape, and then only the advanced mode shows it. Text typed into a row is written as a quoted literal with its quotes, backslashes and control characters escaped, so it is data and never code. The format does not change and there is no migration.
  - **The lists** come from `runtime::compile::expression_names(project, flow, node)`: the fields of the event (with the options of the command, and whether each is optional), the steps that run before the node (always, or on only some paths), the declared variables and `error.*` after an `error` port, each with a `ValueKind` so the builder offers the right operators. It uses the same structure and dominators as compile, so a name offered at a node is a name compile accepts there.
  - **The panel.** A field of kind `Condition` (the `condition` of a branch) opens in the builder when `condition_from_source` reads it and in the advanced mode, a CodeMirror editor, when it returns nothing; a field of kind `Expression` uses the editor alone. The editor sits in a shadow root so the CSP needs no `unsafe-inline` for styles. Confirming a new alias calls `rename_alias` and replaces the project as one step of the undo history. A name of a row that the list of the node does not offer is shown as missing and never changed; compile reports the read on the field.
  - **Parsing and rewriting are in Rust.** The desktop commands `expression_names`, `condition_to_source`, `condition_from_source` and `rename_alias` call `runtime`; the frontend does not parse CEL.
- A text field is a template: plain text with `{{ expression }}` segments. The template source is written by the bot's author. **Values that come from Discord users are inserted as text and never evaluated as expressions** or templates.
- **Aliases and renaming:** `runtime::rename::rename_alias` gives a node its new alias and rewrites the reads of `steps.<alias>` in the expressions and the `{{ }}` segments of the templates of its flow (`ExpressionEngine::rename_step`). The places are found in the token stream and the result is checked against the syntax tree: it must parse to the original tree with exactly the reads of the old alias renamed, otherwise that field is refused, so text that only looks like a read (a string, a longer alias, `event.options.steps.old`) is never changed. A field that cannot be rewritten (it does not compile yet, a text that would pass its limit) is left as it is and reported. Compile reports any read left pointing at nothing.

### 4.3 Variables

Declared in `bot.botproj`: `name`, `type` (integer, decimal, text, boolean), `scope`, `initial`.

| Scope | Key | Persisted |
|---|---|---|
| `run` | the current run | no |
| `bot` | none | yes |
| `server` | guild id | yes |
| `member` | guild id + user id | yes |
| `user` | user id | yes |

- Variables are **read** through `vars.<scope>.<name>` in expressions and **written** by the *Set variable* node (`data.set_variable`: `variable` as `scope.name`, `operation` `set` or `add`, and `value` as an expression of the type of the variable; it publishes the new value as `value`). There is no *Get variable* node.
- Expression functions must be pure, so reading is done before evaluation: the runtime takes the variables each node's expressions mention (the same list the compile step reports) and fetches the persistent ones in one batch just before the node runs, once per run. Within a run, reads are kept in a per-run cache that the run's own writes update. A missing row reads as `initial`; a decimal declared with a whole number reads as a decimal. `run` variables live in the run and never reach the storage.
- The key of a stored value comes from the event: `event.guild.id` (`server`), `event.guild.id` and `event.user.id` (`member`) or `event.user.id` (`user`), each a Discord id of at most 20 digits. An event without them (a command used in a direct message, for example) fails the node that needs them with `error.kind` `invalid_value`.
- Across runs there is no locking. For counters, use the atomic `add` operation of *Set variable* (`value = value + n` in one statement). It fails with `invalid_value` instead of wrapping when the result does not fit.
- A text variable holds at most 4000 characters; a decimal is finite.

## 5. Execution model

### 5.1 Dispatch and runs

1. The platform delivers a normalized **event** (`runtime::platform::Event`: its kind, for a slash command the command name, the fields a flow reads as `event.*` and the interaction a reply goes to).
2. `Runtime::dispatch` looks up the flows whose trigger matches (for a slash command, the command name; command names are unique across flows) and starts one **run** per flow as an independent tokio task.
3. A run holds its event, the outputs of the steps so far and the declared variables (each reads its `initial` value until the storage gives it another, §4.3). It walks the flow from the trigger. Nodes are in topological order, so the next node to run is the queued one with the lowest index: a node runs **once**, after every node before it that is going to run, which is what the compile checks on `steps.*` assume. Each node follows the output port it returned, and a port can lead to several nodes.
4. A run ends when no node is queued, or when a limit is hit.

Limits (provisional values, adjusted by measurement; `runtime::run::Limits`): a global cap of 64 simultaneous runs, a maximum of 500 steps per run (each executed node is a step) and a maximum duration of 60 seconds per run. When a run is dropped or stopped for a limit, it is logged at warning level with the flow and node. What happens to runs goes to a `RunLog` (a trait; the runner turns the records into the lines of §9.2), and every message names the problem and never a value.

### 5.2 Node contract

A node type is declared in one place in `runtime` and has two parts: a **schema** (data) and an **executor**. The schema is real: `runtime::catalog` has `NodeSpec` (type id, version, fields, output ports, named outputs, requirements and, for a trigger, the event it starts and the fields of that event), where each output and each event field has a `ValueKind` for the condition builder, `FieldSpec` and `FieldKind` (text, expression, condition, integer, boolean, closed list of words, asset path, list of objects), and a `Registry` keyed by type and version. The schema and the executor of a node are in one file of `runtime::nodes`, and the executor is a function over a `NodeCx` (the platform, the node's settings and compiled expressions, the state of the run and `error.*` on an error path):

```rust
async fn execute<P: Platform, S: Storage>(cx: &mut NodeCx<'_, P, S>) -> Result<Outcome, NodeError>
// Outcome { port, outputs }; a NodeError sends the run to the "error" port.
```

`NodeError` has a closed kind, which is `error.kind`: `expression`, `invalid_value`, `missing_permissions`, `platform` or `storage` (a variable could not be read or written; its message names a variable at most, never a value or the detail of the database, because a flow can send `error.message` to a user). The runtime dispatches on an enum of node types rather than on a trait object, so `Platform` stays a plain generic trait. The steps to add one are in `CONTRIBUTING.md` §8.

- The schema is serialized to the frontend through `tauri-specta` (`node_catalog`) and drives the palette and, from M10b, the property panel. `runtime` and `graph` derive `serde::Serialize` and `specta::Type` on these types only behind their optional `specta` feature, which `apps/desktop` turns on; the runner never builds it. Compile uses the same schema.
- A test checks that every schema has an executor and every executor has a schema.
- A payload that skips compile still cannot make a node panic: executors read their settings through `NodeCx`, which returns an error for a missing or wrong value.

### 5.3 Errors, deadlines and mentions

- A node that fails returns the `error` port with `error.kind` and `error.message`. If the node has no line out of `error`, the run fails: the detail is logged and, when an interaction is still waiting, the user sees a generic ephemeral message with no internal data.
- **Interaction deadline.** Discord requires a first response within 3 seconds; a token for follow-ups lasts 15 minutes. The runtime starts a 2-second timer when a run starts from an interaction; if no response has been sent, it calls `Platform::defer` with the visibility chosen in the command node (public or ephemeral). After that, the first reply completes the deferred message and the others are follow-ups. The timer and the replies share the state of the response behind a lock held while a message is sent, so the timer never defers a response that is on its way. A deferral that fails is logged and the run goes on; a run that fails after a deferral sends the generic message in place of "thinking".
- **Mentions.** Messages the bot sends carry an empty `allowed_mentions` unless the node explicitly enables user or role mentions.
- **Permissions.** A failed action (HTTP 403) is an ordinary node error with `error.kind = "missing_permissions"`. The *Permission check* node reads the permissions of the **invoking member** that Discord includes in the interaction. A slash command node has a "who can use it" setting, written as the command's default member permissions, so that, for example, a kick command is hidden from people without that permission [proposed].

### 5.4 Shutdown

On `SIGTERM` or `SIGINT` the runner stops accepting events, closes the gateway, waits up to 5 seconds for the runs in progress (`runner::GRACE`), closes the database and exits with code `0`. A signal that arrives while the bot is still connecting stops it there. The handlers stay installed until the process ends, so a second signal during the close does nothing. A run that is still going after the 5 seconds is logged as left behind, and the process exits without closing the database; SQLite recovers its log on the next start.

### 5.5 Performance practices

Applied only where a measurement justifies them (no fixed budgets).

- Compile resolves the graph to arrays with index-based references and precomputes what it can, so a run does no name lookups.
- The runner uses `tokio` with few threads (`current_thread` or one or two workers), enables only the intents and cache resources the nodes need, and keeps dependencies small.
- The release profile and the allocator are chosen by measurement (the default allocator on `musl` is slow).
- Before relying on `twilight`'s memory advantage, benchmark a minimal bot against `serenity`; the `Platform` trait keeps the choice reversible.

## 6. Expression engine

- `ExpressionEngine` is a trait in `runtime` (`crates/runtime/src/expr`); the implementation, `CelEngine`, uses the `cel` crate (`=0.15.0`, no default features) from one module, and no other crate imports it. The scope an expression reads is plain data (`serde_json::Value`) in four namespaces, and a result comes back as the same kind of data.
- Besides `compile`, the trait has `syntax` (an expression described as a `Syntax` tree with no `cel` type, which `Condition::from_source` reads) and `rename_step` (the reads of `steps.<alias>` renamed, see §4.2). Both live in the `cel_engine` folder, the only code that uses `cel`.
- Compile (`ExpressionEngine::compile`) checks the source length, the nesting and the number of operators, parses it, refuses functions outside a closed list and names outside `event`, `steps`, `vars` and `error` (macro variables are tracked), and lists the paths it reads (`References`) and the named functions it calls. The payload stores the source text; the runner compiles it once when it starts. Compiled programs are `Send + Sync` and shared across runs.
- A template (`Template`) is split into text and `{{ expression }}` segments by a small scanner that knows quoted text and nested braces, then each segment is compiled the same way. A literal `{{` is written `{{ '{{' }}`. A segment renders text, numbers and booleans; null, lists and maps are errors.
- One base `Context` (with the standard library) is built once; each evaluation gets a child from `new_inner_scope()`, which borrows the parent, so the context is not rebuilt per event. Only the namespaces the expression reads are converted into the child.
- CEL gives no static type check in this crate, so type mistakes appear at run time and take the `error` path; compile catches syntax, unknown names and unknown functions. Evaluation errors name the problem and never carry values, which may be text from Discord users.
- Registered functions are pure: no I/O, no clock, no randomness. Time-dependent values are fields of the event (`event.timestamp`) or the run, not functions. The closed list is `ALLOWED_FUNCTIONS` in `cel_engine.rs` and a test fails if it changes without the test.
- Limits, all provisional **[measure]** (`crates/runtime/src/expr/limits.rs`): an expression is at most 2 KiB, a template 16 KiB, 512 syntax nodes, 64 levels deep, 256 operators or chain characters (the parser and the tree's destructor recurse on those, and a test runs the largest allowed chains on a 512 KiB stack), and two macros nested. A scope holds at most 4096 values, 128 KiB of text, 1024 elements per list or map and 16 levels, checked when it is built; a result is at most 64 KiB.

## 7. Platform and Discord

`Platform` is the trait the runtime sees: it delivers normalized events and executes actions (reply, send message, add role, kick, …). `platform-discord` implements it on twilight. A `MockPlatform` (in `runtime::platform`) implements it for tests: it records every action and can be told to fail the next ones or to wait. `PlatformError` is a closed list that carries no data from the platform.

- **Intents and cache** are computed at compile from the nodes' `requires` and stored in the payload. The runner enables only those intents and keeps only the cache resources the nodes need. A node that needs a privileged intent (`GUILD_MEMBERS`, `MESSAGE_CONTENT`) shows a notice in the editor.
- **Commands** are global by default. If `.env` defines `DISCORD_DEV_GUILD_ID`, they are registered only in that server. At start the runner fetches the registered commands, compares them with the payload's definitions, and sends only differences (create, update, delete), because Discord allows 200 command creations per day per server. The comparison (`platform_discord::commands::plan`) matches by type and name and checks every field the payload defines against what Discord returns, counting the defaults Discord leaves out as present and ignoring what it adds (`id`, `version`, `contexts`); it does not use the hash in the payload, so a command edited by hand in the Developer Portal is put back. Only slash, user and message commands are managed; others (an Activity's entry point) are never touched. A bad command stops the start before the first call.
- **Gateway:** twilight handles reconnection. Discord allows 120 events per connection per 60 seconds (exceeding it disconnects the bot) and 1,000 identifies per 24 hours across shards (hitting it resets the bot token), so the runner never reconnects in a tight loop and queues outgoing events.
- **The adapter** (`platform-discord`). `Discord::connect` enables only the intents of `Requirements.intents` (an unknown name is an error), builds the cache only when `Requirements.cache` is not empty, installs the `ring` TLS provider (twilight leaves the choice to the application) and checks the token with one request. `Discord::run` reads the gateway, parses only the event types it needs (interactions and ready; every type while there is a cache), normalizes each slash command (`event::normalize`: Discord ids as text, `event.member.permissions` as a list of permission names, `event.timestamp` from the interaction id, options as `{ name: value }`, an error for an option of a kind the editor does not define or text past 6000 characters) and calls `dispatch`; a flow never runs inside the loop. After an error it waits 1 second, doubling to 60, and starts over with the next event. The interaction token stays in the adapter (`interactions`, at most 1024 for 14 minutes); the runtime holds only the id. A reply is the response (`create_response`, then the message is looked up for `message_id`), the first message after a deferral edits the "thinking" message (`@original`), the rest are follow-ups; mentions are empty unless the node says so. A 403 is `MissingPermissions` and any other failure is `Failed`; no text from Discord reaches an error, a log line or a `Debug` output, and `Token` has no `Display`.
- **Privileged intents.** `GUILD_PRESENCES`, `GUILD_MEMBERS` and `MESSAGE_CONTENT` are privileged: a bot used by fewer than 10,000 people can enable them in the Developer Portal, but apps in 100 or more servers must be verified and have each one approved. The editor tells the user which nodes need one.
- **Slash command limits** (read from Discord's documentation on 2026-10-22), validated at compile: at most 100 global `CHAT_INPUT` commands plus 15 `USER` and 15 `MESSAGE` commands per app, and the same numbers per guild; names 1-32 characters, descriptions 1-100, up to 25 options per command, subcommands nested one group deep, and 8000 characters of combined text per command.
- **Entities** (roles, channels, members) are set in the editor by pasting an ID into a validated field.
- **No command framework.** Frameworks such as `poise` define commands at compile time with macros; here the user defines them in the editor and they arrive at run time, so commands are registered directly through the Discord API.

## 8. Storage

- One SQLite database file `bot.sqlite` in the data directory, created by the runner on first run with mode 0600 (a link or a folder at that path is refused). WAL mode, `synchronous = FULL`, foreign keys on, a 1 MiB `cache_size`, a 5 second `busy_timeout` and `trusted_schema` off.
- `rusqlite` is synchronous: one connection lives on a **dedicated thread** that receives jobs over a channel (`storage-sqlite`). This serializes writes, keeps a single connection's memory, and keeps blocking calls off the async runtime. Dropping the last handle ends the thread and closes the database, folding the log in.
- The `Storage` trait (`runtime::storage`) has `check_variables`, `get_many` (one batch, one snapshot), `set`, `add` and `reset_variable`. A value is a `StoredValue`: an integer, a decimal, a text or a boolean.
- Schema (version 1):

  ```sql
  CREATE TABLE variable_types (
    scope TEXT NOT NULL CHECK (scope IN ('bot', 'server', 'member', 'user')),
    name  TEXT NOT NULL,
    type  TEXT NOT NULL CHECK (type IN ('integer', 'decimal', 'text', 'boolean')),
    PRIMARY KEY (scope, name)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE variables (
    scope TEXT NOT NULL,
    key   TEXT NOT NULL,        -- '' | guild id | 'guild:user' | user id
    name  TEXT NOT NULL,
    value ANY NOT NULL,         -- integer, real, text; a boolean is 0 or 1
    PRIMARY KEY (scope, key, name),
    FOREIGN KEY (scope, name) REFERENCES variable_types (scope, name)
      ON DELETE CASCADE ON UPDATE CASCADE
  ) STRICT, WITHOUT ROWID;
  ```

  A missing row means the declared initial value. A write names the type it expects and is refused by the database if the variable is not recorded with that type. Tables for the bot's own data (*Next* in the roadmap) will use a separate namespace and are designed in their own milestone.
- **Counter:** `add` is one `INSERT ... ON CONFLICT DO UPDATE SET value = value + n ... RETURNING value`, guarded so that a sum that stops being an integer, or a decimal that stops being finite, changes nothing and is reported as an overflow. Runs on one connection and connections on one file both lose no count.
- **Migrations:** the schema version is `PRAGMA user_version`, and `MIGRATIONS[n]` (`storage-sqlite`) takes version `n` to `n + 1`. On start the runner refuses a database newer than it understands (the message says to update the app) and a database of another program (version 0 with tables); for an older one it first writes a consistent copy next to it (`VACUUM INTO`, named `bot.sqlite.v<version>.bak`, then `.bak.1` and so on; an existing file is never overwritten, and the copy has mode 0600) and migrates inside one transaction, which a failing step rolls back. Every version has a sample database in `crates/storage-sqlite/tests/samples/`.
- **Types:** `check_variables` runs when the bot starts, before the first run, and records the declared type of each persistent variable (a `run` variable is not stored). If the payload declares a different type for a stored variable, it refuses to start with a message that names the variable and `--reset-variable <scope>.<name>`. Integer to decimal converts the values (exact up to 2^53). A type with no value stored for it changes without a reset. Any other change needs `runner --reset-variable <scope>.<name>`, which deletes the stored values and the recorded type of that variable (`Storage::reset_variable`). The check is all or nothing, and a variable that is stored but no longer declared keeps its values.
- The exporter never copies a database, and the editor's test data stays in `.botinventor/`.

## 9. Local run and export

### 9.1 Local run

1. The app compiles the project to `.botinventor/run/payload.bin`.
2. It starts the runner (a sidecar bundled with `externalBin`, found next to the app's executable and started with `tokio::process` from Rust; the webview has no plugin permission) with a cleared environment and only these variables: `BOT_INVENTOR_PAYLOAD` (the payload file), `BOT_INVENTOR_ENV_FILE` (the project's `.env`), `BOT_INVENTOR_ASSETS_DIR` (`assets/`) and `BOT_INVENTOR_DATA_DIR` (`.botinventor/data/`). In an exported bot the same directory variables are optional overrides; the token and `DISCORD_DEV_GUILD_ID` are read from `.env`. Without them the `.env`, `assets/` and `data/` are looked for next to the executable, never in the working directory. `BOT_INVENTOR_DISCORD_PROXY` (a `host:port`, plain HTTP) sends the HTTP requests to a stand-in for Discord; it exists for the tests of the runner, is read only from the process environment and never from `.env`, and the app does not set it.
3. The runner reads the token from `.env` itself. The token goes from the webview to Rust once, when it is typed (`set_token`), and never back: `token_status` returns whether one is set and the development server id, nothing else. `set_token` accepts 1 to 256 of `A-Z a-z 0-9 . _ -`, so it cannot add or change another line, and rewrites `.env` through a temporary file and a rename with mode 0600, keeping its other lines; a link or a folder at `.env` is refused.
4. The runner prints **JSON lines** on standard output. The app (`supervisor.rs`) reads them line by line (at most 64 KiB per line, the rest of a longer one is dropped) and sends typed `RunEvent`s through a Tauri `Channel`, which is meant for ordered, high-volume data (events are not): `Log` (a `LogLine` with the fields of §9.2; a line that is not one becomes a `warn` line of source `engine`, and a line of standard error, where the `error:` line of a failed start goes, an `error` line) and `Status` (`starting`; `running` at the first line of output; `stopping`; `exited` with the code, the signal, a reason from the table of §9.3 and whether the person asked for it). `start_bot` takes the project the webview shows and compiles it in Rust: with an error it starts nothing and returns the diagnostics. One bot runs at a time.
5. Stop: `SIGTERM`, then a kill after 10 seconds (the runner waits up to 5 for its runs). Closing the app stops the bot the same way, and a child that is dropped is killed as a last resort. An unexpected exit is reported with its code and the bot is not restarted. A change to the payload means stop and start again.

### 9.2 Log lines

```json
{"ts":"2026-10-23T14:05:09.042Z","level":"warn","source":"engine","run":"r1","flow":"ping","node":"reply","msg":"…","fields":{}}
```

`ts` is RFC 3339 in UTC with milliseconds. `level` is `info`, `warn` or `error`. `source` is `engine` (the runtime's and the runner's own messages) or `bot` (the *Log* node, with the nodes of M14). `run` is `r<n>`, counting the runs since the runner started, and is `null` for a line that is not about one run, as `flow` and `node` are. `fields` is an object for data that belongs to a line; engine lines leave it empty. A message is cut at 2000 characters.

The runner writes one line per write, redacts the token (and its JSON-escaped form) from every value and from the finished line, and limits the rate: at most 100 lines in each second. What is over the limit is dropped, and the first line of the next window (or the last line of the process) says how many were dropped. A failure to start is not a log line: it is one `error: …` line on standard error, with the exit code of §9.3.

### 9.3 Runner command line and exit codes

`runner` (the payload at the end of its own executable) · `--payload <file>` (a payload file; wins over `BOT_INVENTOR_PAYLOAD`) · `--dump` (the payload as JSON) · `--check` (verify the payload, `.env` and assets without connecting) · `--reset-variable <scope>.<name>` (delete the stored values of a variable the bot declares) · `--version` · `--help`. At most one of `--dump`, `--check`, `--reset-variable`, `--version` and `--help` is given, and no argument takes the token.

| Code | Meaning |
|---|---|
| `0` | A clean shutdown, or a command that finished |
| `1` | Any other failure: a payload that cannot be read or is damaged, Discord unreachable or answering with an error, the gateway closed for good, a database failure |
| `2` | A configuration problem the user fixes: a bad argument, no `.env` or token, a token Discord rejects, an invalid `DISCORD_DEV_GUILD_ID`, a missing or unsafe asset, a payload file that cannot be opened, an unknown intent or command, a variable whose type changed, a database that is newer or not the app's |
| `3` | A payload version this runner does not read (newer: update the app; older: export the bot again) |

### 9.4 Export

`exporter::export` takes the runner executable (as built, with no bot inside: one that already has a footer is refused), the `Payload` that `compile` made, the project folder (only its `assets/` is read), the output folder and the name of the bot. It does not compile: a project with errors never reaches it. It writes:

```
<out>/
├─ my-bot          the runner, then the payload, then the footer (§3.2); mode 0755
├─ assets/         a copy of the project's assets/
└─ .env.example    DISCORD_TOKEN= and a commented DISCORD_DEV_GUILD_ID=, with no value; mode 0644
```

`.env` is the user's and `data/` is created on first run; the exporter never writes either, never reads the project's `.env` and never copies a database. Directories are resolved relative to the executable, with environment overrides (the same mechanism local run uses). Later, cross-export would need one prebuilt runner per target system, built in CI and attached to each release.

- **Name.** A plain file name of at most 64 bytes: it does not start with a dot or a dash, has no separator or control character, and is not `assets` or `data`.
- **Assets.** All of `assets/` is copied; only regular files and folders are accepted and nothing is followed (a link or any other kind of file is refused and named). The limits are 4096 files and folders, 16 levels and 256 MiB **[measure]**; names must be text. Copied files get mode 0644 and folders 0755, whatever the project has. An asset that `requirements.assets` names and the project lacks refuses the export.
- **Output.** A folder that exists (not a link) or one whose parent exists, which is created with mode 0755. The project folder itself, and anything inside its `assets/`, are refused (the copy would copy itself).
- **Staging.** Everything is written first to a staging folder inside the output and moved into place with renames, the executable last. An error before the moves leaves the output as it was (a folder the export created is removed), and the checks of what is already in the output (a folder where a file goes, a link where a folder goes) are made before anything is written.
- **Exporting again** into the same folder replaces the executable (a rename, so it works while the old one runs), `.env.example` and the files of `assets/` that the project has. It touches nothing else: `.env`, `data/`, an asset added by hand and any other file stay as they are.
- The end-to-end tests are in `crates/runner/tests/export.rs`; `crates/exporter/examples/export.rs` writes a folder from the command line (`CONTRIBUTING.md` §2).

## 10. Security

The baseline (priorities, the token in `.env`, no `unsafe`, no panics on untrusted input, supply chain) is in *Security baseline* in `DECISIONS.md`. How the design handles each risk:

| Risk | Measure |
|---|---|
| Token leaking | The child runner's environment is cleared; the token is redacted from every log line and never reaches the webview |
| Hostile input from Discord users | Treated as data: inserted into templates as text, never evaluated. Mentions are off by default |
| Expressions | CEL: no side effects, always terminates; pure functions only; size limits |
| Runaway bots | Acyclic flows, step and time limits per run, a cap on simultaneous runs |
| Files | Asset names resolve only inside the assets directory; absolute paths and `..` are rejected |
| The app | Tauri capabilities with least privilege, a restrictive CSP, filesystem access limited to the open project, every command validates its input in Rust (`DEVELOPMENT-GUIDE.md` §7) |
| Internal detail | A failed run shows users a generic message; details go to the log |

An *HTTP request* node (state *Next*) needs its own design before it is built: size and time limits, redirects, and blocking the local network by default.

## 11. Testing

- **Runtime:** run flows against `MockPlatform` and in-memory storage, and assert the recorded actions; snapshot tests (`insta`) for compile output and for error messages; property tests (`proptest`) for the validator.
- **Formats:** every `format_version` and payload version keeps a sample project or payload, and a test migrates or loads each one.
- **Storage:** tests on a real SQLite file in a temporary directory, including migrations and the type-mismatch refusal.
- **Discord adapter:** unit tests for event normalization and the command diff; a manual checklist against a real test server, because the network is not part of the automated suite.
- **Bad input:** every node has a test that gives it wrong types, missing fields and out-of-range values and expects an error, not a panic. The project loader, the payload decoder and the expression parser get `cargo-fuzz` targets once they exist, run on a schedule rather than on every pull request **[proposed]**.
- **Editor:** `vitest` for logic and the store; WebdriverIO end-to-end tests of the renderer in Chrome on a fake backend (`cargo xtask e2e`, `DEVELOPMENT-GUIDE.md` §10.1); a few tests of the real app with `tauri-driver` (create → run → export) from M12.

## 12. Not in this design

Plugins and third-party nodes (nodes are a closed catalog compiled into `runtime`; opening it needs a sandbox design first), other platforms (the `Platform` trait keeps the door open), sharding, voice and hosting. See `ROADMAP.md` §5.

## 13. Open points

To settle in the milestone that first touches each one:

1. The numeric limits above are provisional and need measuring. **[measure]**
2. That the bundled runner starts in the AppImage and `.deb` packages with a cleared environment. **[verify]**
