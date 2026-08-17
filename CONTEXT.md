# Bot Inventor

A desktop application where someone with no programming knowledge builds a Discord bot by connecting nodes on a canvas, tests it live, and exports it as JavaScript they host themselves.

## Language

> **Naming collision**: **Node** always means a step in a Flow. The JavaScript runtime is always written **Node.js**, never "Node" on its own.

### The editor

**Canvas**:
The surface where the user places and connects Nodes.
_Avoid_: board, editor, workspace

**Node**:
A single step of the bot's behaviour, drawn as a box on the Canvas.
_Avoid_: block, component, step

**Port**:
A connection point on the edge of a Node. Every Port is either an Execution Port or a Data Port.
_Avoid_: handle, socket, pin

**Wire**:
The connection between two Ports. An Execution Wire defines the order things happen in; a Data Wire carries a value from one Node's output to another's input.
_Avoid_: edge, connection, link

**Trigger**:
A Node with no Execution input that starts a run in response to something that happened on Discord — a slash command, a button press, a gateway event.
_Avoid_: entry point, event node, hook

**Flow**:
The whole graph hanging off a single Trigger — everything that happens when that Trigger fires. Each Flow occupies its own Canvas.
_Avoid_: graph, workflow, sequence

**Coercion**:
A predefined automatic conversion between two Port types that the editor applies when a Wire is connected, instead of rejecting the connection. It is drawn on the Wire: never invisible.
_Avoid_: cast, implicit conversion

**Failure Port**:
The extra Execution Port carried by Nodes that can fail, where execution continues when the action could not be completed. Leaving it unconnected stops the Flow and records the error.
_Avoid_: catch, error handler, error output

### The application

**Dashboard**:
The screen listing the user's Projects, and the first thing the application shows. It is where a Project is created, imported, renamed, duplicated and deleted; opening one from here leads to the editor. A Project is shared from the editor's Menu Bar, where the Project that is open is the one being handed over.
_Avoid_: home, start screen, launcher, library

**Console**:
The collapsible panel along the bottom of the editor, showing what a Session is saying while it runs.
_Avoid_: log, terminal, output panel

**Session Output**:
One line the Console shows: something the bot printed, a note from the application, or a problem.
_Avoid_: log line, console line

**Project Options**:
The dialog, opened from the editor, holding how one Project connects to Discord: the Secret it signs in with and its Test Server. Nothing else lives here — a Project is named, duplicated and deleted from the Dashboard, and shared from the Menu Bar.
_Avoid_: settings, preferences, properties, configuration

**Menu Bar**:
The row along the top of the application, holding every menu the user opens: what they do with the Project as a whole, what the editor shows them, and what the application is. It is the only place an action lives that belongs to no single Flow.
_Avoid_: toolbar, ribbon, main menu

**Minimap**:
The small picture of the whole Flow, shown in the corner of the Canvas, where a Trigger is told apart from everything else at a glance. Whether it is shown is the user's preference and never travels in a Project File.
_Avoid_: overview, navigator, thumbnail

### Building

**Project**:
The unit the user creates, opens and edits: the complete definition of one bot, with all its Flows. It is not saved — the application owns where it lives and keeps it up to date on its own.
_Avoid_: bot, workspace, file

**Project File**:
The `.botinv` file a Project is written to. It holds the Project and nothing else: never a Secret, so it can be sent to somebody else as it is.
_Avoid_: save file, document, botinv (on its own)

**Share**:
Writing a Project to a `.botinv` somewhere outside the application's own storage, for somebody else to import. What is shared is the Project and never a Secret. Sharing hands over a bot's design; an Export hands over a bot that runs.
_Avoid_: export, publish, save as

**Import**:
Taking a Project File from anywhere on disk into the application's own storage, as a Project of this user's own: a new id, and the Secret and Test Server asked for on the way in. It copies rather than opens — the file stays where it is and is no longer needed, and the same file taken in twice is two Projects.
_Avoid_: open, load, restore

**Compiler**:
Translates a Project into JavaScript. It emits the same behaviour in two modes — Development Mode (with Tracing) and Build — from a single definition of each Node.
_Avoid_: generator, transpiler, engine

**Development Mode**:
Running the real bot, connected to Discord with a test token, from inside the application and with Tracing enabled.
_Avoid_: dev mode, preview, test mode

**Session**:
One run of a Project in Development Mode: the process the bot lives in, from pressing Run until it stops. It belongs to the application — closing the application ends it.
_Avoid_: run, instance, process, execution

**Sidecar**:
The Node.js binary shipped inside the installer, which every Session runs on. The user never installs it and never sees it.
_Avoid_: runtime binary, embedded node, engine

**Test Server**:
The Discord server a Session registers its commands to. Registering to one server takes effect immediately, unlike the global registration an Export uses.
_Avoid_: guild, dev server, sandbox

**Tracing**:
The instrumentation Development Mode injects into the generated code so the Canvas can highlight the Node currently executing and show the values travelling along each Wire.
_Avoid_: debugging, logging, telemetry

**Run**:
One execution of a Flow, from its Trigger firing until the Flow stops. A Session is the bot being alive; a Run is one thing the bot did while it was. Runs are numbered so that two of them happening at once can be told apart, and the Canvas shows the most recent.
_Avoid_: execution, invocation, session, trace

**Trace Event**:
One thing Tracing reports about a Run: a Node entered, a Node completed, or the value a Wire carried. A value in a Trace Event is already text, serialised for the person reading it and never read back.
_Avoid_: log line, span, message

**Build**:
Producing the final JavaScript the user takes away: no Tracing, and containing only what their Flows actually use.
_Avoid_: compile, production build

**Export**:
Writing the result of a Build to disk, in one of two formats: Single File or Node Project.
_Avoid_: publish, generate, output

**Single File**:
An Export format: one `.mjs` with every dependency bundled inside, run with `node bot.mjs` and no install step.
_Avoid_: bundle, standalone, portable

**Node Project**:
An Export format: a folder of readable source split across several files, with `package.json` and configuration, for someone who wants to read, version or hand-edit the bot.
_Avoid_: folder export, npm project, source export

**Secret**:
A sensitive value that Nodes reference by name and that is never stored inside the Project: it lives in the operating system keychain while editing, and as an environment variable in the exported bot.
_Avoid_: credential, variable, token, API key

### Memory

**Memory**:
What the bot remembers between runs. A key-value store backed by a local file sitting next to the exported bot.
_Avoid_: database, state, storage, cache

**Scope**:
Who a Memory entry belongs to: Global (the whole bot), Server, or User.
_Avoid_: namespace, context, level
