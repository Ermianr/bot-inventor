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

### Building

**Project**:
The unit the user opens, edits and saves: the complete definition of one bot, with all its Flows.
_Avoid_: bot, workspace, file

**Compiler**:
Translates a Project into JavaScript. It emits the same behaviour in two modes — Development Mode (with Tracing) and Build — from a single definition of each Node.
_Avoid_: generator, transpiler, engine

**Development Mode**:
Running the real bot, connected to Discord with a test token, from inside the application and with Tracing enabled.
_Avoid_: dev mode, preview, test mode

**Tracing**:
The instrumentation Development Mode injects into the generated code so the Canvas can highlight the Node currently executing and show the values travelling along each Wire.
_Avoid_: debugging, logging, telemetry

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
