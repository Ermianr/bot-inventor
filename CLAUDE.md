# Bot Inventor

Windows desktop app (Tauri) where non-programmers build Discord bots by wiring Nodes on a Canvas, run them live, and export them as self-hosted JavaScript.

Read [CONTEXT.md](./CONTEXT.md) before naming anything — it is the domain glossary and it is binding. Architectural decisions and their reasoning live in [docs/adr/](./docs/adr/).

## Commands

Bun is the package manager and Turborepo the task runner; run everything from the repository root.

```bash
bun install
bun run desktop:dev    # the real app: builds the sidecar, then tauri dev
bun run dev:web        # the editor in a browser, no Tauri shell
bun run test           # vitest across every package
bun run check-types
bun run check          # biome check --write . — this one rewrites files
```

End-to-end tests are Playwright and are not part of `bun run test`: `cd apps/web && bun run test:e2e`.

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

## Git conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, where the subject is lowercase, imperative and carries no trailing period. The scope is the package or area the change lands in — `schema`, `nodes`, `compiler`, `runtime`, `ui`, `web`, `adr`, `scripts` — and is omitted when a change is genuinely repository-wide.

The types in use are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build` and `ci`. A breaking change is marked `type(scope)!:` and explained in the body.

The subject says what the change does for the product, not which files moved: `feat(runtime): register a Project's commands per-server and globally`, never `feat(runtime): update discord-js-runtime.ts`. The body is for why the change is shaped the way it is, and for anything a reader would otherwise have to reconstruct from the diff. Issues are referenced from the body (`Refs #8`, `Closes #8`), never from the subject.

Branch names use the same vocabulary: `type/short-description` in kebab-case, such as `feat/single-file-export` or `fix/wire-coercion-badge`. One branch per issue, and never commit to `main` directly.

## Stack

Bun workspaces + Turborepo. Vite 8, React 19, TanStack Router, Tailwind 4, shadcn/ui in `packages/ui`, Tauri v2, Biome for lint and format, Zod for schemas.

## Package layout

- `packages/schema` — Project types, Zod schemas, `schemaVersion` migrations
- `packages/nodes` — the Node catalogue. Each Node's visual definition and its code generation live in **the same file**; do not split them (see ADR 0001)
- `packages/compiler` — Project graph to JavaScript, both modes
- `packages/runtime` — thin layer over discord.js plus Memory; this is what generated code consumes
- `packages/config` — `tsconfig.base.json`, extended by every other package
- `apps/web` — the editor, shipped inside Tauri. Its `src-tauri` side owns Secrets, the Node.js sidecar and the life of a Session
- `scripts` — repository tasks. `bun run sidecar` downloads the pinned Node.js and builds the Runtime resource; `desktop:dev` and `desktop:build` run it first. Neither artifact is in git

## Testing

Unit tests are Vitest and sit next to what they test, as `src/**/*.test.ts`. Playwright specs live in `apps/web/e2e`, with their Page Objects in `apps/web/e2e/pages`.

`test` and `check-types` depend on `^build` in `turbo.json`, so a package's workspace dependencies must be built before its tests can resolve them — prefer `bun run test` at the root over calling `vitest` inside a package. In `apps/web`, `check-types` deliberately runs a full `vite build` before `tsc --noEmit`; it is slow on purpose.

## Non-negotiables

- Secrets never touch the Project file. OS keychain while editing, environment variables in exports.
- One Compiler, two modes. Never add an interpreter path for Development Mode.
- Every Project format change ships with a migration and a backup step.
