# Bot Inventor

Windows desktop app (Tauri) where non-programmers build Discord bots by wiring Nodes on a Canvas, run them live, and export them as self-hosted JavaScript.

Read [CONTEXT.md](./CONTEXT.md) before naming anything — it is the domain glossary and it is binding. Architectural decisions and their reasoning live in [docs/adr/](./docs/adr/).

## Language policy

**Everything written in this repository is in English.** No exceptions:

- Source code: identifiers, types, functions, files, folders
- Comments and JSDoc
- Documentation: `CONTEXT.md`, ADRs, READMEs, design notes
- Commit messages, branch names, PR descriptions
- Test names and test data
- Log messages, error messages thrown in code, CLI output
- Generated code emitted by the Compiler, including its comments

Domain terms come from `CONTEXT.md` and are used verbatim in code — a Wire is `Wire`, never `edge` or `connection`, even though React Flow calls its own concept an edge. When translating between our model and a library's vocabulary, the boundary is where the renaming happens, and our name wins on our side of it.

The single exception is **user-facing UI text**, which is translatable: it never appears as a literal in components, only as a key resolved through the i18n layer. English is the source locale; Spanish ships in v1.

This applies to Node identifiers too: a Node's internal id is stable and English (`discord.member.addRole`); only its label is translated. Renaming an internal id breaks saved Projects.

Chat with the user happens in Spanish — that is conversation, not repository content.

## Stack

Bun workspaces + Turborepo. Vite 8, React 19, TanStack Router, Tailwind 4, shadcn/ui in `packages/ui`, Tauri v2, Biome for lint and format, Zod for schemas.

## Package layout

- `packages/schema` — Project types, Zod schemas, `schemaVersion` migrations
- `packages/nodes` — the Node catalogue. Each Node's visual definition and its code generation live in **the same file**; do not split them (see ADR 0001)
- `packages/compiler` — Project graph to JavaScript, both modes
- `packages/runtime` — thin layer over discord.js plus Memory; this is what generated code consumes
- `apps/web` — the editor, shipped inside Tauri

## Non-negotiables

- Secrets never touch the Project file. OS keychain while editing, environment variables in exports.
- One Compiler, two modes. Never add an interpreter path for Development Mode.
- Every Project format change ships with a migration and a backup step.
