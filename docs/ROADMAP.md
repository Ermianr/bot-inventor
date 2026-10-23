# ROADMAP

What the project plans and in which order. There is no version target and no dates. How to work on it is in [`CONTRIBUTING.md`](CONTRIBUTING.md); the decisions behind it are in [`DECISIONS.md`](DECISIONS.md).

**Stage: building the base.** The architecture, decisions, tooling and contribution rules are written, the repository is public, and the workspace skeleton (M0), the project model (M1), the payload codec (M2), the expression engine (M3), compile (M4) and the runtime core (M5) are done. There is no connection to Discord yet.

## 1. Vision

A cross-platform, open source desktop application to build bots **without code** from a node editor. The first platform is Discord; the design allows others later. The app runs the bot locally with live logs, or exports it as a standalone executable. Linux comes first. Priorities: security, then functionality, then performance and low memory.

Three small reference bots drive the first milestones: **Ping** (`/ping` replies), **Welcome** (greets new members and assigns a role) and **Moderation** (`/kick`, `/ban`, `/timeout` with permission checks, an error path and a log message).

## 2. Milestones

The single unit of planned work: a capability stage with a definition of done (DoD), sized for one pull request (a few days; if it grows past about a week it is split). Statuses: `draft` (a sketch of the DoD), `ready` (criteria agreed in full, can be started), `in progress`, `done`, `dropped`. The rules for taking and finishing one are in `CONTRIBUTING.md` §3.2. The full criteria of a milestone are written before it starts; a DoD is shown by a test or a command, not by a statement.

| M | Name | Depends on | Status | Definition of done (sketch) |
|---|---|---|---|---|
| M0 | Workspace skeleton | — | done | The criteria below |
| M1 | Project model | M0 | done | The entry below |
| M2 | Payload codec | M1 | done | The entry below |
| M3 | Expression engine | M0 | done | The entry below |
| M4 | Compile and validate | M2, M3 | done | The entry below |
| M5 | Runtime core | M4 | done | The entry below |
| M6 | Variables and storage | M5 | draft | Variables survive a restart on a real SQLite file; the atomic counter loses no counts under concurrent runs; migration and type-mismatch tests pass, including integer to decimal conversion and `--reset-variable` |
| M7 | Discord adapter | M5 | draft | Ping runs on a real test server; only the intents the nodes need are enabled; a second start sends no command changes; the response is deferred after 2 seconds; tests for event normalization and the command diff |
| M8 | Runner | M2, M7 | draft | `runner --payload` runs Ping from the command line; SIGTERM closes it cleanly; exit codes match `ARCHITECTURE.md` §9.3; a test shows the token never reaches the output |
| M9 | Export | M8 | draft | The exported folder runs on its own, without the app, on a machine with only the folder; a missing `.env` or asset fails with a clear message; `--dump` equals the compile output |
| M10 | Editor canvas | M5 | draft | A project can be built, saved and reopened in the app; panels are generated from the node schema; undo and redo; validation errors mark the exact field |
| M11 | Condition builder | M3, M10 | draft | A condition is built from lists and the generated expression shows in the advanced mode (CodeMirror); renaming a node rewrites the expressions that use it; a broken reference is reported |
| M12 | Local run and export in the app | M8, M9, M10 | draft | Ping is built from scratch in the app, run locally with live logs, stopped and exported; the token field writes `.env` with mode 0600 and the frontend can never read it back |
| M13 | Reference bots | M6, M7, M12 | draft | Welcome and Moderation are built in the editor, run locally and exported; the nodes they need are done as node tasks |
| M14 | More nodes | M13 | draft | The *Next* rows of section 4, one small task each; each ships with schema, executor and bad-input test |
| M15 | Beyond Linux and distribution | M14 | draft | Linux packages (AppImage, `.deb`), release pipeline with `release-plz`, docs site (`mdBook`) and other systems; to be written when M13 is done |

### Done

- **M0. Workspace skeleton** (#1). The Rust and pnpm workspace, `cargo xtask` (`dev`, `lint`, `test`, `build`, `layers`, `bindings`), CI on Linux (lint, tests, bindings check, Conventional Commits on the title and the commits), the empty Svelte app in a Tauri window with a restrictive CSP and one allowed command, and the baseline configuration files.
- **M1. Project model** (#2). The project side of the `graph` crate. `Project::load` and `Project::save` read and write the `.botproj` folder (`bot.botproj`, `flows/*.flow.json`, a generated `.gitignore`) with a stable key order, through a temporary file and a rename; the `ping` sample (`crates/graph/tests/samples/v1/ping/`) saves back to identical bytes. Node ids, flow names, aliases, port names and variable names are validated types. A newer `format_version` is refused with a message that says to update the app; older ones go through a table of migration steps (empty for now), and a test requires a sample for every version. Symbolic links, non-regular files, files over 4 MiB and more than 256 flows are refused, and a table of bad inputs (invalid JSON, wrong types, missing and unknown fields, invalid UTF-8, deep nesting, bad names) returns typed errors that name the file and never panic. The payload types and codec are M2; the checks on the graph are M4; the TypeScript bindings of these types come with the editor (M10). The backup copy before a migration comes with the first real migration.
- **M2. Payload codec** (#4). The payload side of the `graph` crate. `Payload` has the contents of `ARCHITECTURE.md` §3.2 (version, app version, flows with their nodes and lines as index adjacency, expression sources as text, the event table, the command definitions with their hash, the variables and the requirements) and no editor data; `check` verifies that every index points inside its list. `Payload::encode` writes MessagePack with field names, compressed with zstd and its content checksum, and gives the same bytes for the same payload; `Payload::decode` reads it back. Bad payloads (empty, truncated at any length, a damaged byte, not zstd, not MessagePack, trailing bytes, wrong types, missing and unknown fields, bad names, an index that points nowhere) return a typed `PayloadError` and never panic; the version is read before the rest, so a newer one says to update the app, an older one to export again, and version 0 is invalid. A payload is refused above 16 MiB compressed, 64 MiB decompressed (a zstd bomb is read only up to the limit, and a frame asking for a larger window is refused) or nested deeper than 128 levels, and `encode` refuses what `decode` would. The container footer (`BOTINVPL`, container version, payload length) is written by `write_container` and found at the end of a `Read + Seek` by `read_container`, which tells a file with no footer apart from a footer that cannot be trusted. `dump_json` and `cargo xtask dump <file>` print a payload, or the payload at the end of an exported bot, as JSON; `runner --dump` will use the same function in M8. `tests/payload_samples/v1/` holds the Ping payload and its dump, and a test requires a sample for every version. The compile step that fills a payload is M4, the node catalog that gives the settings a meaning is M5, and the `cargo-fuzz` target for the decoder comes with the other fuzz targets.
- **M3. Expression engine**. The `expr` module of the `runtime` crate. `ExpressionEngine` is a trait whose only implementation, `CelEngine`, uses `cel` (`=0.15.0`, no default features) from one module; the features and the closed list of operators and functions are in `DECISIONS.md`. A source is compiled once into a `Send + Sync` expression and evaluated against a `Scope` (`event`, `steps`, `vars`, `error` as plain data) in a child of one shared base context. `Template` splits plain text with `{{ expression }}` segments, understanding quoted text and nested braces (`{{ '{{' }}` writes a literal `{{`); what the segments produce, including text from Discord users, is inserted as text and never evaluated. `References` lists the full paths an expression reads (`event.user.id`, `steps.<alias>.<output>`, `vars.<scope>.<name>`, `error.kind`), stopping at a dynamic index, and the named functions it calls; macro variables are not references and an unknown root is an error. Limits on the source, nesting, operators, macro nesting, the scope and the result are in `ARCHITECTURE.md` §6, with a test for each, and a test runs the largest allowed chains on a 512 KiB stack. Evaluation errors carry no values. A table of bad inputs and `proptest` runs over arbitrary text find no panic, and the real conditions of Welcome and Moderation (role and permission checks, role hierarchy, text and number comparisons, an optional reason with a default, and the log templates) evaluate to the expected value. Checking references against triggers, nodes and declarations is M4.
- **M4. Compile and validate** (#6). The compile step of `ARCHITECTURE.md` §3.3, in the `runtime` crate, with the node schemas it needs. `runtime::catalog` has `NodeSpec`, `FieldSpec`, `FieldKind`, `PortSpec`, `OutputSpec`, `NodeRequires` and `TriggerSpec` as in §5.2 and a `Registry` keyed by type and `type_version` (a duplicate key is refused); it declares the schemas, with no executor, of `discord.slash_command`, `discord.reply` and `logic.branch`. `compile(&Project, app_version)` returns a `Report` with the diagnostics in a fixed order, the variables each node reads and, only when there is no error, the `Payload`; a warning does not block it. A diagnostic has a severity, a stable code, the flow, the node id, the field path (`lines[n]` for a line) and a message that names the field and the limit and never a setting's value. Tests cover each structure rule (duplicate ids and aliases, unknown nodes, ports and versions, a line into the trigger, a repeated line, no trigger or two, an unreachable node, cycles), the settings (missing, unknown, wrong type, text and number limits, closed lists, asset paths), the expressions (syntax, `event.*` against the trigger and its options, `steps.*` as always, sometimes or never before the node, `vars.*` against the declarations, `error.*` against the `error` ports) and the variable declarations. The Discord limits each have a test at the limit and one over it, apart from the 8000 characters, which only a command with more than 25 options reaches, and the options limit is reported at the same time. A flow is limited to 2048 nodes and 8192 lines, every pass is iterative, and a test compiles the largest flow on a 512 KiB stack. `Requirements` are the sorted union of what the nodes in use declare; a template with no `{{ }}` segment is not stored as an expression; `CommandDef::hash` is the SHA-256 of the definition with its keys in order, and a test changes one option and sees it change. The `ping` sample compiles with no diagnostic to the payload committed in `tests/payload_samples/v1/`, which replaced the hand-written one, and the order of nodes and lines in the files does not change the bytes. A snapshot test (`insta`) fixes the message of every code, apart from `invalid-payload`, a guard on `Payload::check` that no project reaches. `proptest` runs find no panic on arbitrary projects, compile a random valid flow with every index in range, find a cycle whenever a line goes back to an ancestor, and give the same result when the nodes and lines are shuffled. The node rows of section 4 stay *Now* until M5 gives them an executor.
- **M5. Runtime core**. The run side of the `runtime` crate. `Platform` (`platform` module) is the trait the runtime sees, with `Event`, `Reply` and a closed `PlatformError` that carries no data from the platform, and `MockPlatform` records every action and can fail the next ones or wait. A `Runtime<P>` is built from a `Payload` (`Runtime::new`, or `with` for the engine and the limits): it finds the schema of every node, compiles every expression and template once, and refuses with a typed `RuntimeError` what it cannot run. `dispatch(event)` starts one tokio task per flow the event reaches (a slash command reaches the flow of that command, any other event the flows its kind is routed to) and `drain()` waits for them. A run holds the event, the outputs of the steps so far and the declared variables (every scope reads its `initial` value until storage arrives in M6), and walks the flow with the lowest-index node first, so a node runs once, after every node before it that runs. The nodes are in `runtime::nodes`, each with its schema and its executor: `discord.slash_command` (sets the visibility of the replies), `discord.reply` (the first reply is the response, the next ones are follow-ups, with no mention allowed and a content of 1 to 2000 characters once written; it publishes `message_id`) and `logic.branch`; a test requires that every schema has an executor and the other way round. A node that fails goes through its `error` port with `error.kind` (`expression`, `invalid_value`, `missing_permissions` or `platform`) and a message that names the setting and never its value; with no line out of `error` the run fails, the detail goes to the `RunLog` and, if the interaction has no response yet, the user gets one generic ephemeral message. The limits are 64 simultaneous runs (an event past it is dropped with a warning), 500 steps and 60 seconds per run, each with a test at the limit and one over it, the largest flow runs on a 512 KiB stack, and a `proptest` run finds no panic with arbitrary event data. Every node has a bad-input test over payloads that skip compile. The first "Adding a node" recipe is in `CONTRIBUTING.md` §8. The 2-second deferral is M7, the JSON log format and signals are M8, and the other nodes of section 4 are M6 and M13. `tokio` (`rt`, `sync`, `time`) is the only new dependency.

## 3. Current focus

Ranked; pick from the top unless a draft pull request already claims it.

1. **Write the full criteria of M6 (variables and storage) and M7 (Discord adapter)**, which M5 unblocks and which can go in parallel.
2. **M6 and M7**, until variables survive a restart and Ping runs on a real test server.

## 4. Node catalog

The nodes. `Privileged` marks a node that needs a Discord privileged intent. **Done** nodes have their schema and executor; **Now** nodes are made in M6, M7 and M13; **Next** nodes are the small tasks of M14; **Later** has no plan yet.

**Events (triggers)**

| Node | State | Notes |
|---|---|---|
| Bot ready | Now | |
| Slash command | Done | Options become output values |
| Member joined | Now | Privileged (`GUILD_MEMBERS`); used by Welcome |
| Member left | Next | Privileged (`GUILD_MEMBERS`) |
| Button clicked, select menu chosen, modal submitted | Next | |
| Message created | Next | Privileged (`MESSAGE_CONTENT`) |
| Reaction added | Next | |
| Schedule (timer) | Next | |
| Voice state changed | Later | |

**Actions**

| Node | State | Notes |
|---|---|---|
| Reply to interaction (ephemeral option) | Done | |
| Defer | Now | Automatic after 2 seconds, with the adapter (M7) |
| Send message (text, embed) | Now | Also used for log messages |
| Add / remove role | Now | |
| Kick / ban / timeout member | Now | With permission checks |
| Attachments from `assets/` | Next | |
| Edit / delete message | Next | |
| Send direct message | Next | |
| Add buttons or select menus to a message, show modal | Next | |
| Add / remove reaction | Next | |
| HTTP request | Next | Needs its own security design first: size and time limits, local network blocked by default |
| Create thread | Later | |

**Logic**

| Node | State | Notes |
|---|---|---|
| Branch (if / else) | Done | Condition built visually, or typed as an expression |
| Permission check (role or permission) | Now | |
| On error path | Now | |
| Switch | Next | |
| Loop over a list | Next | With a maximum number of iterations |
| Delay | Next | |
| Cooldown per user | Next | |
| Subgraph / reusable block | Later | |

**Data**

| Node | State | Notes |
|---|---|---|
| Set variable | Now | Variables are declared with a type and a scope (`ARCHITECTURE.md` §4.3) |
| Text template (`{{ expression }}`) | Now | Variables are inserted with a button |
| Log | Now | Appears in the live log |
| Counter | Next | |
| Table: insert, query (order, limit), update, delete | Next | Needed for leaderboards |
| Random, date and time | Next | |

## 5. Later, and not planned

**Later** (wanted, no plan yet): Windows and macOS builds with code signing; export for another system than the current one; other interface languages; automatic updates; optional embedding of assets in the executable; Rust code generation as an advanced export; other platforms (Telegram, Twitch, Slack) through the `Platform` trait.

**Not planned:** a code or script node (the bot is strictly no-code); plugins or third-party nodes (they need their own security design); voice and audio; sharding for very large bots; hosting the bots (the user runs the exported bot on their own machine or server); real-time collaboration, a marketplace or accounts (not part of a local-first tool).
