# Bundling Node.js as a Tauri sidecar instead of relying on the system installation

Bot Inventor is a Tauri (Rust) desktop application whose target audience cannot program, yet the bot they build runs on Node.js. We decided to **ship a Node.js binary inside the installer** as a sidecar, rather than detecting the system installation or embedding a JS engine in Rust (Deno core / QuickJS). Detecting the system installation pushes onto the user an install they do not understand, and that is where most non-programmers give up; embedding a different engine would break the guarantee that the bot tested in Development Mode is identical to the exported one.

## Consequences

- The installer grows by roughly 50MB.
- Packaging for a new platform means packaging its sidecar too, which reinforces the decision to limit v1 to Windows.
- Updating the sidecar's Node.js version changes the runtime underneath every user's in-development bot: pin it and move it deliberately.
