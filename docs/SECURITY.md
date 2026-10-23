# Security policy

## Reporting a vulnerability

**Do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting: on the repository page, open **Security → Report a vulnerability** (or go to <https://github.com/Ermianr/bot-inventor/security/advisories/new>).

Please include what you found, the version, how to reproduce it, and the impact you see. You will get an answer as soon as the maintainer can; this is a volunteer project and there is no guaranteed response time yet.

## What counts

Examples of problems we want to hear about:

- The bot token reaching a place it should not (a project file, a payload, a log line, the interface, a process argument).
- A bot, an expression or a template reading files outside the project's `assets/` folder.
- Text written by a Discord user being evaluated as an expression or template.
- A flow that can run without limits, or a way to make an exported bot do more than its flows say.
- A crafted project file or payload that crashes or takes control of the app or the runner.
- A weakness in how the app starts, stops or talks to the runner.

The design that these reports are measured against is in [`ARCHITECTURE.md`](ARCHITECTURE.md), section 10.

## Malicious files

Projects and payloads are untrusted input, and they are shared between people. **Do not attach a potentially harmful project folder, payload or exported bot to a public issue.** Describe it instead: its format, size, a cryptographic hash, what happens when it is opened, and the command that reproduces it. Report the problem privately (above) and arrange a private transfer if the file is needed. A fixed parser problem gets a permanent regression test, using a minimized file that is safe to share.

## Supported versions

The project is before 1.0 and has no release yet. Only the latest version receives fixes. This section is updated when the first release is published.

## What the project does not promise

- The bot token is stored as plain text in the project's `.env` file, with owner-only permissions. Protect your disk and your backups.
- An exported bot's payload is not encrypted; embedding it in the executable is packaging, not protection.
- The project does not sign the bots users export.
