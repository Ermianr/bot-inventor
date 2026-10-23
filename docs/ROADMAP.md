# ROADMAP

What the project plans and in which order. There is no version target and no dates. How to work on it is in [`CONTRIBUTING.md`](CONTRIBUTING.md); the decisions behind it are in [`DECISIONS.md`](DECISIONS.md).

**Stage: building the base.** The architecture, decisions, tooling and contribution rules are written, the repository is public, and the workspace skeleton (M0) and the project model (M1) are done. There is no bot functionality yet.

## 1. Vision

A cross-platform, open source desktop application to build bots **without code** from a node editor. The first platform is Discord; the design allows others later. The app runs the bot locally with live logs, or exports it as a standalone executable. Linux comes first. Priorities: security, then functionality, then performance and low memory.

Three small reference bots drive the first milestones: **Ping** (`/ping` replies), **Welcome** (greets new members and assigns a role) and **Moderation** (`/kick`, `/ban`, `/timeout` with permission checks, an error path and a log message).

## 2. Milestones

The single unit of planned work: a capability stage with a definition of done (DoD), sized for one pull request (a few days; if it grows past about a week it is split). Statuses: `draft` (a sketch of the DoD), `ready` (criteria agreed in full, can be started), `in progress`, `done`, `dropped`. The rules for taking and finishing one are in `CONTRIBUTING.md` §3.2. The full criteria of a milestone are written before it starts; a DoD is shown by a test or a command, not by a statement.

| M | Name | Depends on | Status | Definition of done (sketch) |
|---|---|---|---|---|
| M0 | Workspace skeleton | — | done | The criteria below |
| M1 | Project model | M0 | done | The entry below |
| M2 | Payload codec | M1 | draft | MessagePack + zstd round-trips; a truncated or damaged payload and an unknown version are refused with a clear error; `--dump` prints JSON; a sample payload of every version loads |
| M3 | Expression engine | M0 | draft | CEL and `{{ }}` templates evaluate; text from Discord users is inserted but never evaluated; the references of an expression are listed; registered functions are pure; bad input returns errors; the real conditions of Welcome and Moderation (role and permission checks, text and number comparisons) evaluate correctly with `cel`, before anything is built around it |
| M4 | Compile and validate | M2, M3 | draft | Every rule of `ARCHITECTURE.md` §3.3 has a test; each error carries flow, node id and field path; a project with errors cannot be exported; snapshot tests for the messages; property tests for the validator |
| M5 | Runtime core | M4 | draft | The Ping graph loads from a `.botproj` folder, compiles and runs against `MockPlatform`, which records the reply; limits stop a runaway run; a run that fails with no error path logs the detail and replies generically; every node has a bad-input test; the first "Adding a node" recipe is written |
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

## 3. Current focus

Ranked; pick from the top unless a draft pull request already claims it.

1. **Write the full criteria of M2 (payload codec) and M3 (expression engine).** M2 depends on M1, which is done, and M3 only on M0, so they can start in parallel.
2. **The chain M2, M4, M5**, until the Ping graph loads, compiles and runs against the mock platform. M5 also writes the first "Adding a node" recipe, which opens the node tasks to contributors.

## 4. Node catalog

The nodes. `Privileged` marks a node that needs a Discord privileged intent. **Now** nodes are made in M5, M6 and M13; **Next** nodes are the small tasks of M14; **Later** has no plan yet.

**Events (triggers)**

| Node | State | Notes |
|---|---|---|
| Bot ready | Now | |
| Slash command | Now | Options become output values |
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
| Reply to interaction (ephemeral option), defer | Now | |
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
| Branch (if / else) | Now | Condition built visually, or typed as an expression |
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
