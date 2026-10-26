<!-- BEST-OF-AI-DEV template v1. How each coding agent finds the rules and what it may do.
     Keep this in sync with .claude/settings.json and .codex/config.toml. -->

# Agent setup

AGENTS.md is the only rules file. Every vendor file below either imports it or is read
alongside it. None of them adds rules of its own.

| Agent | Reads | Permissions live in |
| --- | --- | --- |
| Codex | `AGENTS.md` | `.codex/config.toml`, used only after you trust the project |
| Claude Code | `CLAUDE.md`, which imports `@AGENTS.md` | `.claude/settings.json`; personal overrides in `.claude/settings.local.json` (git-ignored) |
| Grok Build | `AGENTS.md` and `CLAUDE.md` in the same folder, both loaded. Its docs do not mention `@` imports, so keep rules out of `CLAUDE.md` | `.claude/settings.json` (read and translated), or `.grok/config.toml` `[permission]`. Both need folder trust |
| Gemini CLI | `GEMINI.md`, which imports `@AGENTS.md` | `.gemini/settings.json` |
| Antigravity | `AGENTS.md` and `GEMINI.md`, both loaded. `@AGENTS.md` here is a path reference, not an import, so nothing loads twice | its own settings; this template ships none |
| Cursor | `AGENTS.md` | the editor's own settings |

Checked against the vendors' public docs on 2026-10-25: Grok Build's user guide (project rules,
permissions) and Antigravity's rules page. Re-check when you upgrade; these move fast.

## What the committed configs do

- **Claude Code** allows the repo's own check commands and read-only git. It asks before pushing,
  installing packages, `gh`, `curl`, web fetches and edits to CI, hooks, scripts or
  `package.json`. It denies reading `.env*`, `secrets.json`, SSH keys and key files in any
  case and any folder, `--no-verify` anywhere in a command, `git commit -n`, force pushes
  (`--force*`, `-f`, `+ref`), `reset --hard`, setting or unsetting `core.hooksPath` (reading it
  with `git config --get` is allowed), git's `--output`, `--ext-diff` and `--no-index`,
  `git show`, `git log` and `git cat-file` of `.env`, `.pem` or `.key` paths, `git diff` of
  `.env` and `.env.local` (`.env.example` stays readable), `git grep` for common key prefixes,
  git output redirected with `>`, `>>`, `1>` or `&>` (`2>&1` and `->` inside a format string
  are fine), and `rm -rf`. Those git rules exist because `git diff`, `git log` and `git show` are
  allowed: without them, a read-only allow could write files, run a diff program, or print a
  secret from history or from outside the repo. The rules put `*` before the flag, so the flag's position
  does not matter. `scripts/test/agent-config.test.mjs` runs a table of commands through a model
  of the documented matcher. Change a rule and the table tells you what moved.
  Deny and ask rules apply as soon as the file is in the repo. Allow rules wait until you trust the folder.
- **Grok Build** reads the same `.claude/settings.json`, so one file covers both. Its matcher also
  checks every segment of a chained command, and it is case-sensitive, which is why both
  `core.hooksPath` spellings are listed. It ignores the whole file until you trust the folder.
- **Codex** runs in `workspace-write`: no writes outside the repo and no network from
  commands. Web search uses the cached index. Variables named like keys, secrets or tokens are
  stripped from the command environment; Codex's default keeps them.

## What they do not do

Deny lists are speed bumps, not a sandbox. Claude Code documents that rules do not see through
`git -C <dir> push`, `git -c key=value ...`, a full path such as `/usr/bin/git`, or a script
that runs git for the agent. Combined short flags (`git commit -anm x`) also get past the `-n`
rule. Also not caught: a redirect glued to the command (`git log>out.txt`), hooks set through
`GIT_CONFIG_*` variables or an odd-case key (`core.HOOKSPATH`), `git diff` of other `.env.*`
names, a `git grep` pattern split by quotes, and history searches (`git log -p`, `-S`, `-G`).
Denying those would block everyday review commands, and secrets.mjs keeps `.env` files out of
history in the first place. The test file keeps these as named gaps so they stay visible. Treat the list as a
statement of intent that catches honest mistakes; a PreToolUse hook can parse the command
properly if you need more. Real isolation comes from:

1. one worktree per agent, so a bad command damages one branch;
2. Codex's sandbox, or a container or VM for anything you would not run yourself;
3. server-side rules that no local config can skip: a `main` ruleset with required `pr-checks`,
   no force pushes, and a required review by an identity other than the agent's. A new repo has
   none of these until you create them, and the review rule is empty while agents push as you.

Paths outside the repo (`~/.ssh`, cloud credentials) belong in your user-level settings, not
in a committed file.

<!-- REPO-SPECIFIC: tools, MCP servers or commands this repo adds, and why. -->
<!-- /REPO-SPECIFIC -->
