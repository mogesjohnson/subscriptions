<!-- BEST-OF-AI-DEV template v1. Windows notes for agents and humans. -->

# Windows

The default shell on a stock Windows machine is Windows PowerShell 5.1, not PowerShell 7.
Agents write PowerShell 7 by habit. Every `.ps1` in `scripts/` must run in 5.1.

## Scripts

| Script | What it does | Default |
| --- | --- | --- |
| `scripts/test-windows.ps1` | Self-test: hooks, commit rules, pr-size and both cleanup scripts, in a temp repo | read-only |
| `scripts/cleanup-worktrees.ps1` | Lists merged, stale or missing worktrees; `-Apply` removes them. Keeps any with ignored files such as `.env` unless you add `-Force` | dry run |
| `scripts/mcp-doctor.ps1` | Lists MCP servers whose agent is gone; `-Apply` stops them | dry run |

Run them from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-windows.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-worktrees.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\mcp-doctor.ps1
```

`-ExecutionPolicy Bypass` applies to that one process. It does not change the machine policy.

`test-windows.ps1` prints PASS, FAIL or SKIP per check and exits 1 on any FAIL. If a setup
step fails (temp folder, copy, `git init`, `git config`, `setup-hooks.mjs`, a fixture commit),
it prints `ABORT` and stops: checks in a half-built repo only produce noise. It clears `GIT_*`
variables first, never runs npm, and never installs lefthook; that check is SKIP when lefthook
is absent.

## 5.1 rules that agents break

- **No `&&` or `||`.** They are parse errors in 5.1. Use separate lines, or
  `cmd1; if ($LASTEXITCODE -eq 0) { cmd2 }`.
- **No `??`, `?.`, ternaries or `ForEach-Object -Parallel`.** All of them are PowerShell 7 only.
- **Quote every path.** Profile folders can contain spaces. Use `-LiteralPath` so `[` and `]`
  are not treated as wildcards.
- **ASCII only in `.ps1` files.** 5.1 reads a file without a BOM in the ANSI code page, so an
  em dash in a comment turns into mojibake. In a string, it changes behavior.
- **Native exit codes live in `$LASTEXITCODE`.** `$?` is unreliable after `2>&1`, which also
  wraps every stderr line as an error record. Convert them back with `"$_"`.
- **`Out-File` and `>` write UTF-16 in 5.1.** Use `[System.IO.File]::WriteAllText` for files
  that Git, Node or a hook will read.
- **`.ps1`, `.cmd` and `.bat` are CRLF; everything else is LF.** `.gitattributes` enforces it.
  Git hooks must stay LF, because Git for Windows runs them with its bundled `sh`.

`scripts/test/ps1-compat.test.mjs` checks the operator and ASCII rules on every `npm test`, even
on machines without PowerShell. `test-windows.ps1` is the real check. Run it on Windows after
changing any script, hook or check.

<!-- REPO-SPECIFIC: Windows-only setup this repo needs (long paths, Developer Mode, WSL). -->
<!-- /REPO-SPECIFIC -->
