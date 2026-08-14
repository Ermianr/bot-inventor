# A Session runs a pre-bundled Runtime and reports one line at a time

Pressing Run has to put a live bot on Discord in the time it takes to look up at the screen, on a machine with no Node.js, no `npm install` and no terminal. Two decisions make that possible, and both are visible in the Compiler.

**The Runtime is bundled once, when the application is packaged**, into a single `runtime.mjs` that ships as a Tauri resource beside the Node.js sidecar (ADR 0002). Starting a Session writes the entry point the Compiler rendered into a folder of its own and copies that file in beside it; the entry point imports `./runtime.mjs` and resolves nothing else. The alternative — bundling the Project on every Run, the way an Export does — puts esbuild between the user and their bot every single time, for a result that would be identical on every press.

**The bot reports to the application over its own standard output**, one JSON message per line behind a prefix. Anything without that prefix is the bot's own output and goes to the panel unchanged. There is no port to allocate, no socket to fail to bind and nothing to leak: the pipe already exists because we spawned the process, and its closing is also how the bot learns that Bot Inventor is gone.

Both ends of the protocol are defined in `packages/compiler/src/development-session.ts` — the code that emits it is generated a few lines above the code that reads it, which is the only way to keep them from drifting.

## Consequences

- The installer carries the bundled Runtime as well as the sidecar. Every Session on a given build runs on the same Runtime, the one that build's tests ran against, rather than on whatever resolution happened to find.
- A Runtime change reaches a developer's Development Mode only after `bun run sidecar` rebuilds the resource. `desktop:dev` and `desktop:build` both run it first.
- A message this build does not understand is dropped rather than shown, so a newer Session talking to an older editor degrades to silence rather than to protocol text on the user's screen.
- Tracing will travel on this pipe too when there is a Canvas to receive it; it is not a message kind yet, because one nobody reads is a contract that has never been tested. If the volume of trace messages ever becomes the reason the panel stutters, the fix is to batch them at the sending end, not to open a second channel.
