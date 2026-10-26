# AGENTS.md

<!-- BEST-OF-AI-DEV template v1. Canonical rules for every agent and human in this repo.
     CLAUDE.md, GEMINI.md and any other vendor file point here and add nothing else.
     Keep this file at or under 70 lines. Long detail goes in RULES.md or docs/. -->

## What this repo is

<!-- REPO-SPECIFIC: one or two sentences. What it does, who uses it, current version. -->
<!-- /REPO-SPECIFIC -->

## Commands

Run these from the repo root. They are the only definition of "checks pass".

<!-- REPO-SPECIFIC: replace with the real commands. Delete any that do not exist. -->
- Install: `npm ci`
- Lint: `npm run lint`
- Types: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Hooks (once per clone): `node scripts/setup-hooks.mjs`
<!-- /REPO-SPECIFIC -->

## Where things live

<!-- REPO-SPECIFIC: five to ten lines. Path, then what it holds. No full tree. -->
<!-- /REPO-SPECIFIC -->

## How work flows

1. Every change starts from a task spec (`docs/tasks/`) or an issue with acceptance criteria.
2. One task, one branch, one worktree: `<agent>/<short-topic>`, off fresh `main`.
3. Small PRs. The size gate fails above 600 changed lines (lockfiles excluded); aim under 400.
4. Conventional Commits: lowercase `type(scope): subject`, at most 72 characters. The hook checks it.
   End each commit with `Refs: #N` (or the task file) and `Agent: <name>` trailers (unchecked).
5. The PR template is the report. Fill every section; untick what you did not check.
6. The author never reviews or merges their own PR. See RULES.md R6.
7. Merge only when `gh pr checks <n> --watch --fail-fast` is green. See RULES.md R15.

## Done means

- Every acceptance criterion maps to a test or a recorded check.
- Lint, types, tests and build pass locally, and the output was read, not assumed.
- Each result is reported as `pass`, `fail`, `blocked` or `not_run`. Never round up.
- Docs that describe the changed behavior are updated in the same PR.
- Nothing is left running: no dev servers, watchers, MCP servers or stray worktrees.
  On Windows, `scripts/cleanup-worktrees.ps1` and `scripts/mcp-doctor.ps1` list them (dry run).

## Hard rules

Read RULES.md before your first commit. The short version:

- Never commit secrets, `.env*`, personal paths (`C:\Users\...`) or raw transcripts.
- Never force-push, rewrite pushed history, or use `--no-verify`.
- Never edit files outside this repo or outside your task's scope.
- Ask before adding a dependency, changing CI, or touching auth, billing or data deletion.
- When the spec and the code disagree, stop and say so. Do not guess.

## Repo-specific rules

<!-- REPO-SPECIFIC: at most ten lines. Domain rules only this repo needs
     (for example "evidence receipts are sanitized" or "the reference site is read-only").
     Anything that applies to every repo belongs in BEST-OF-AI-DEV instead. -->
<!-- /REPO-SPECIFIC -->
