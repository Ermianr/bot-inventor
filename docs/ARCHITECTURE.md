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
| `storage-sqlite` | The `Storage` implementation on `rusqlite`: schema, migrations, a dedicated thread | `runtime` (traits) |
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

- `bot.botproj` holds: `format_version` (integer), `name`, `platform` (`discord`), settings, and the **variable declarations**. It does not list flows; the app scans `flows/`.
- Each `*.flow.json` holds one flow: its nodes (with their editor position under a separate `editor` key) and its lines.
- Files are written with a stable key order and stable node ids, through a temporary file and a rename. Versioning and migrations are in *Project and payload formats* in `DECISIONS.md`.

### 3.2 Payload (what the runner executes)

MessagePack compressed with zstd. It carries only logic: no positions, comments or groups. Contents **[proposed]**:

- the payload version (integer) and the app version that produced it;
- for each flow: nodes in an array, lines as index adjacency (no name lookups at run time), and the pre-parsed settings of every node;
- the **expression sources** as text, parsed once when the runner starts (the AST is not stored);
- a table from event kind to the flows that start with it;
- the **command definitions** to register, with a hash of each;
- the variable declarations;
- the computed requirements: Discord intents, which cache resources are needed, the assets that are referenced.

Container when exported **[proposed]**: `[runner executable][payload bytes][footer]`, where the footer is a magic value, the container version, and the payload length. The runner reads the end of its own executable to find it (and uses `--payload <file>` for local runs). zstd's content checksum catches a damaged payload. The runner has `--dump`, which prints the payload as JSON.

### 3.3 Compile (project → payload)

The same function is used when the editor validates and when the app exports **[proposed]**. In order:

1. Load the project and migrate it if needed.
2. **Structure:** ids are unique, aliases are unique inside a flow, lines point to existing ports, every flow has exactly one trigger, every node is reachable, and the flow has **no cycles**.
3. **Settings:** each node's settings are checked against its schema (types, limits).
4. **Expressions:** every expression and template is parsed; each reference is resolved: `event.*` against the trigger's fields, `steps.<alias>.<output>` against nodes that run before this one, `vars.<scope>.<name>` against the declarations. A reference to a node that runs only on some paths is a warning; to one that never runs before it, an error.
5. **Discord limits:** command and option names and lengths, option counts, the 8000-character command size, the number of commands (the limits are in section 7).
6. **Requirements:** compute intents, cache needs, referenced assets and the variables each node reads.
7. Emit the payload.

Every error carries the **flow, the node id and the field path**, so the editor can mark the exact field. A bot with errors cannot be exported.

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

- The **visual condition builder** (milestone M11 in `ROADMAP.md`) lists exactly these names. The user picks from lists; the builder writes the CEL expression; an advanced mode shows it in CodeMirror.
- A text field is a template: plain text with `{{ expression }}` segments. The template source is written by the bot's author. **Values that come from Discord users are inserted as text and never evaluated as expressions** or templates.
- **Aliases and renaming:** references to `steps.<alias>` are rewritten by the editor on rename, by parsing the expression, not by text search. Compile reports anything left broken.

### 4.3 Variables

Declared in `bot.botproj`: `name`, `type` (integer, decimal, text, boolean), `scope`, `initial`.

| Scope | Key | Persisted |
|---|---|---|
| `run` | the current run | no |
| `bot` | none | yes |
| `server` | guild id | yes |
| `member` | guild id + user id | yes |
| `user` | user id | yes |

- Variables are **read** through `vars.<scope>.<name>` in expressions and **written** by the *Set variable* node. There is no *Get variable* node.
- Expression functions must be pure, so reading is done before evaluation: the compile step lists the variables each node's expressions mention, and the runtime fetches them in one batch just before the node runs. Within a run, reads are kept in a per-run cache that the run's own writes update.
- Across runs there is no locking. For counters, use the atomic *counter* operation (`value = value + n` in one statement).

## 5. Execution model

### 5.1 Dispatch and runs

1. The platform delivers a normalized **event** (`Ready`, `SlashCommand`, `MemberJoined`, …).
2. The dispatcher looks up the flows whose trigger matches (for a slash command, the command name; command names are unique across flows) and starts one **run** per flow as an independent tokio task.
3. A run holds its event, the outputs of the steps so far, the per-run variable cache and counters. It walks the flow from the trigger, node by node, following the output port the node returned.
4. A run ends when a node has no line out of the chosen port, or when a limit is hit.

Limits **[proposed, numbers to be measured]**: a global cap on simultaneous runs, a maximum number of steps per run, a maximum duration per run. When a run is dropped for a limit, it is logged at warning level with the flow and node.

### 5.2 Node contract **[proposed]**

A node type is declared in one place in `runtime` and has two parts: a **schema** (data) and an **executor**. A sketch, not final code:

```rust
struct NodeSpec {
    type_id: &'static str,           // "discord.send_message"
    version: u32,
    fields: Vec<FieldSpec>,          // name, kind, limits, widget hint, expression allowed?
    ports: Vec<PortSpec>,            // "next", "error", …
    outputs: Vec<OutputSpec>,        // named values later nodes can read
    requires: Requirements,          // intents, bot permissions, assets
}

trait NodeExec {
    async fn run(&self, cx: &mut RunCx<'_>) -> Result<Outcome, NodeError>;
}
// Outcome { port, outputs }; a NodeError sends the run to the "error" port.
```

- The schema is serialized to the frontend (through `tauri-specta`) and drives the property panel. Compile uses the same schema.
- A test checks that every schema has an executor and every executor has a schema.

### 5.3 Errors, deadlines and mentions

- A node that fails returns the `error` port with `error.kind` and `error.message`. If the node has no line out of `error`, the run fails: the detail is logged and, when an interaction is still waiting, the user sees a generic ephemeral message with no internal data.
- **Interaction deadline.** Discord requires a first response within 3 seconds; a token for follow-ups lasts 15 minutes. The runner starts a 2-second timer when a run starts from an interaction; if no response has been sent, it defers using the visibility chosen in the command node (public or ephemeral). After that, replies become follow-ups.
- **Mentions.** Messages the bot sends carry an empty `allowed_mentions` unless the node explicitly enables user or role mentions.
- **Permissions.** A failed action (HTTP 403) is an ordinary node error with `error.kind = "missing_permissions"`. The *Permission check* node reads the permissions of the **invoking member** that Discord includes in the interaction. A slash command node has a "who can use it" setting, written as the command's default member permissions, so that, for example, a kick command is hidden from people without that permission [proposed].

### 5.4 Shutdown

On a termination signal the runner stops accepting events, waits up to a few seconds for runs in progress, closes the gateway and the database, and exits **[proposed]**.

### 5.5 Performance practices

Applied only where a measurement justifies them (no fixed budgets).

- Compile resolves the graph to arrays with index-based references and precomputes what it can, so a run does no name lookups.
- The runner uses `tokio` with few threads (`current_thread` or one or two workers), enables only the intents and cache resources the nodes need, and keeps dependencies small.
- The release profile and the allocator are chosen by measurement (the default allocator on `musl` is slow).
- Before relying on `twilight`'s memory advantage, benchmark a minimal bot against `serenity`; the `Platform` trait keeps the choice reversible.

## 6. Expression engine

- `ExpressionEngine` is a trait in `runtime`; the implementation uses the `cel` crate.
- Compile parses each expression to check it and to extract the names it references; the payload stores the source text and the runner parses it once when it starts.
- CEL gives no static type check in this crate **[verify]**, so type mistakes appear at run time and take the `error` path; compile catches syntax and unknown names.
- Registered functions are pure: no I/O, no clock, no randomness. Time-dependent values are fields of the event (`event.timestamp`) or the run, not functions.
- An expression has a maximum source length, and values placed in the context are limited in size.

## 7. Platform and Discord

`Platform` is the trait the runtime sees: it delivers normalized events and executes actions (reply, send message, add role, kick, …). `platform-discord` implements it on twilight. A `MockPlatform` implements it for tests and records every action.

- **Intents and cache** are computed at compile from the nodes' `requires` and stored in the payload. The runner enables only those intents and keeps only the cache resources the nodes need. A node that needs a privileged intent (`GUILD_MEMBERS`, `MESSAGE_CONTENT`) shows a notice in the editor.
- **Commands** are global by default. If `.env` defines `DISCORD_DEV_GUILD_ID`, they are registered only in that server. At start the runner fetches the registered commands, compares them with the payload's definitions (by the stored hash), and sends only differences, because Discord allows 200 command creations per day per server.
- **Gateway:** twilight handles reconnection. Discord allows 120 events per connection per 60 seconds (exceeding it disconnects the bot) and 1,000 identifies per 24 hours across shards (hitting it resets the bot token), so the runner never reconnects in a tight loop and queues outgoing events.
- **Privileged intents.** `GUILD_PRESENCES`, `GUILD_MEMBERS` and `MESSAGE_CONTENT` are privileged: a bot used by fewer than 10,000 people can enable them in the Developer Portal, but apps in 100 or more servers must be verified and have each one approved. The editor tells the user which nodes need one.
- **Slash command limits** (read from Discord's documentation on 2026-10-22), validated at compile: at most 100 global `CHAT_INPUT` commands plus 15 `USER` and 15 `MESSAGE` commands per app, and the same numbers per guild; names 1-32 characters, descriptions 1-100, up to 25 options per command, subcommands nested one group deep, and 8000 characters of combined text per command.
- **Entities** (roles, channels, members) are set in the editor by pasting an ID into a validated field.
- **No command framework.** Frameworks such as `poise` define commands at compile time with macros; here the user defines them in the editor and they arrive at run time, so commands are registered directly through the Discord API.

## 8. Storage

- One SQLite database file `bot.sqlite` in the data directory, created by the runner on first run. WAL mode, `synchronous = FULL`, a small `cache_size`, foreign keys on.
- `rusqlite` is synchronous: one connection lives on a **dedicated thread** that receives requests over a channel. This serializes writes, keeps a single connection's memory, and keeps blocking calls off the async runtime **[proposed]**.
- Schema **[proposed]**:

  ```sql
  CREATE TABLE variables (
    scope  TEXT NOT NULL,       -- 'bot' | 'server' | 'member' | 'user'
    key    TEXT NOT NULL,       -- '' | guild id | 'guild:user' | user id
    name   TEXT NOT NULL,
    value  ANY,
    PRIMARY KEY (scope, key, name)
  ) STRICT, WITHOUT ROWID;
  ```

  A missing row means the declared initial value. Tables for the bot's own data (*Next* in the roadmap) will use a separate namespace and are designed in their own milestone.
- **Migrations:** the runner owns its schema version (`PRAGMA user_version`). On start it refuses a database newer than it understands; for an older one it copies the file to a backup and migrates inside a transaction. The runner also records the declared type of each variable; if the payload declares a different type for a stored variable, it refuses to start with a message that names the variable.
- The exporter never copies a database, and the editor's test data stays in `.botinventor/`.

## 9. Local run and export

### 9.1 Local run

1. The app compiles the project to `.botinventor/run/payload.bin`.
2. It starts the runner (a sidecar bundled with the app **[verify]**) with a cleared environment and only these variables **[proposed]**: the path to the payload, the project's `.env`, `assets/`, and `.botinventor/data/` as the data directory.
3. The runner reads the token from `.env` itself. The token never goes through the webview; the frontend only learns whether one is set. Writing the token creates `.env` with mode 0600.
4. The runner prints **JSON lines** on standard output. The app parses them and forwards them through a Tauri `Channel`, which is meant for ordered, high-volume data (events are not).
5. Stop: terminate signal, then kill after a timeout. An unexpected exit is shown with its exit status. A change to the payload means stop and start again.

### 9.2 Log lines **[proposed]**

```json
{"ts":"…","level":"info","source":"engine","run":"r1","flow":"ping","node":"reply","msg":"…","fields":{}}
```

`source` is `engine` (the runtime's own messages) or `bot` (the *Log* node). The runner redacts the token from every line and limits the log rate.

### 9.3 Runner command line and exit codes **[proposed]**

`runner` (embedded payload) · `--payload <file>` · `--dump` · `--check` (verify payload, `.env` and assets without connecting) · `--version`. Exit code `0` for a clean shutdown, `2` for a configuration problem (missing token or asset), `3` for an unknown payload version, `1` otherwise.

### 9.4 Export

The exporter writes `my-bot` (the runner with the payload appended), `assets/` copied from the project, and a `.env.example`; `.env` is the user's and `data/` is created on first run. Directories are resolved relative to the executable, with environment overrides (the same mechanism local run uses). Later, cross-export would need one prebuilt runner per target system, built in CI and attached to each release.

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
- **Editor:** `vitest` for logic; a few end-to-end tests (create → run → export) later.

## 12. Not in this design

Plugins and third-party nodes (nodes are a closed catalog compiled into `runtime`; opening it needs a sandbox design first), other platforms (the `Platform` trait keeps the door open), sharding, voice and hosting. See `ROADMAP.md` §5.

## 13. Open points

To settle in the milestone that first touches each one:

1. Numeric defaults for run limits, the cap on simultaneous runs and the shutdown wait. **[measure]**
2. How Tauri bundles and locates the runner as a sidecar, and that the cleared environment still lets it start. **[verify]**
3. Whether the `cel` crate exposes the references (variables and functions) of a parsed expression, which compile relies on; otherwise a small walker over the parse tree is needed. **[verify]**
4. Whether to cache the CEL evaluation context per event or build it each time. **[measure]**
5. Behavior when a variable's type is changed in a project that already has data: today the runner refuses to start; a guided migration may be wanted.
6. Naming of environment variables (`DISCORD_TOKEN`, `DISCORD_DEV_GUILD_ID` and the directory overrides).
