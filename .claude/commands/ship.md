---
description: Run the full quality gate, open a PR, merge it into main and clean up branches
allowed-tools: Bash, Read, Edit, Grep, Glob
---

Finish the work on the current branch and land it on `main`.

Run every step in order and STOP at the first failure: report what failed, with the
tool output, and fix it (or ask) before continuing. Never skip a step, never use
`--no-verify`, and never force-push.

## 0. Preconditions

- `git status --porcelain` and `git rev-parse --abbrev-ref HEAD`.
- If the current branch is `main`, stop: this repository never commits to `main`
  directly. Offer to move the pending work onto a `type/short-description` branch.
- If there are uncommitted changes, show them and commit them with a Conventional
  Commit (`type(scope): subject`, lowercase imperative subject, no trailing period)
  before going on. One commit per coherent change.

## 1. Quality gate

From the repository root, in this order:

```bash
bun install --frozen-lockfile
bun run check        # oxfmt + oxlint --fix — this one rewrites files
bun run check-types
bun run test
bun run build
```

If `bun run check` rewrote files, commit the result as `chore: apply formatter`
(or fold it into the previous commit only if that commit is not yet pushed).

Then run the end-to-end suite, which is not part of `bun run test`:

```bash
cd apps/web && bun run test:e2e
```

If Playwright cannot run in this environment, say so explicitly instead of
reporting the gate as green.

## 2. Pull Request

- `git push -u origin HEAD`.
- Open the PR with `gh pr create`, targeting `main`. Title is the Conventional
  Commit subject of the change as a whole; the body explains *why* the change is
  shaped the way it is and references issues (`Refs #N` / `Closes #N`) — never in
  the title. Everything in English.
- If a PR already exists for the branch, reuse it (`gh pr view`) and update its
  body if the scope moved.

## 3. Merge

- Wait for checks: `gh pr checks --watch`. Red checks are a stop, not a warning.
- Merge with `gh pr merge --squash --delete-branch` unless the user asked for a
  different strategy.

## 4. Branch hygiene

```bash
git checkout main && git pull --ff-only
git fetch --prune
git branch --merged main            # local branches already in main
git branch -vv | grep ': gone]'     # local branches whose remote is deleted
```

Delete those branches with `git branch -d` (never `-D` without asking), keeping
`main`. List any branch that is NOT merged and NOT gone, and ask before touching
it — an unmerged branch may be work in progress.

Finish with a short report: what the gate ran, the PR URL, the merge result and
which branches were deleted.
