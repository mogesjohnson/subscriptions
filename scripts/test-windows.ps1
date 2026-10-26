<#
.SYNOPSIS
  BEST-OF-AI-DEV template v1. Self-test for Windows PowerShell 5.1: hooks, size gate and cleanup scripts.

.DESCRIPTION
  Builds a throwaway repo in a temp folder whose name contains a space (to catch unquoted
  paths), copies this scripts/ folder and the .githooks/ next to it, and checks:
    - every .ps1 here parses in this PowerShell;
    - setup-hooks.mjs points Git at .githooks/;
    - the commit-msg hook rejects bad messages and accepts a good one;
    - pr-size passes a small branch and fails a 700-line one;
    - cleanup-worktrees.ps1 (dry run) proposes the merged worktree, keeps the dirty and the
      brand-new ones, and removes nothing;
    - cleanup-worktrees.ps1 -Apply keeps a merged worktree whose only change is an ignored
      .env, removes one that has only node_modules, and -Force then removes the first;
    - mcp-doctor.ps1 (dry run) finds the orphans in a fake process list, and reads the live
      list without stopping anything;
    - lefthook installs and runs the same commit-msg check (SKIP when lefthook is absent).
  Prints PASS, FAIL or SKIP per check. Exit 0 when nothing failed, 1 otherwise.
  If any setup step fails (temp folder, copy, git init or config, setup-hooks, a fixture
  commit), it prints ABORT and stops at once instead of running checks in a broken repo.
  Never touches your real repos or processes, and never runs npm. -Keep leaves the temp
  folder for inspection.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\template\scripts\test-windows.ps1
#>
[CmdletBinding()]
param([switch]$Keep)

$ErrorActionPreference = 'Continue'
$script:results = New-Object System.Collections.ArrayList

function Add-Result {
  param([string]$Status, [string]$Name, [string]$Detail = '')
  [void]$script:results.Add($Status)
  $line = '{0,-5} {1}' -f $Status, $Name
  if ($Detail) { $line = "$line : $Detail" }
  Write-Output $line
}

function Invoke-Tool {
  param([string]$Exe, [string[]]$ToolArgs)
  $lines = New-Object System.Collections.ArrayList
  & $Exe @ToolArgs 2>&1 | ForEach-Object { [void]$lines.Add("$_") }
  return New-Object PSObject -Property @{ Code = $LASTEXITCODE; Out = $lines.ToArray(); Text = ($lines -join "`n") }
}

# A setup step that must work. On failure: report it and abort the whole run.
function Invoke-Setup {
  param([string]$Step, [string]$Exe, [string[]]$ToolArgs)
  $r = Invoke-Tool $Exe $ToolArgs
  if ($r.Code -ne 0) {
    Add-Result 'FAIL' "setup: $Step" "exit $($r.Code): $(Get-Last $r)"
    throw "setup failed: $Step"
  }
  return $r
}

function Write-TextFile {
  param([string]$Path, [string]$Text)
  # UTF-8 without BOM and LF, like the repo. Out-File in 5.1 writes UTF-16.
  [System.IO.File]::WriteAllText($Path, $Text.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Last {
  param($Result, [int]$Count = 3)
  $o = @($Result.Out)
  if ($o.Count -le $Count) { return ($o -join ' | ') }
  return ($o[($o.Count - $Count)..($o.Count - 1)] -join ' | ')
}

# Git exports GIT_DIR and GIT_INDEX_FILE to hooks. If this runs from one, every git call
# below would hit the real repo instead of the temp one. Drop them for this process.
Get-ChildItem -Path 'Env:' | Where-Object { $_.Name -like 'GIT_*' } | ForEach-Object { Remove-Item -LiteralPath ('Env:\' + $_.Name) }
# setup-hooks.mjs skips itself when CI is set, which would fail the hooksPath check.
if (Test-Path -LiteralPath 'Env:\CI') { Remove-Item -LiteralPath 'Env:\CI' }

$scriptsDir = $PSScriptRoot
$parentDir = Split-Path -Parent $scriptsDir
$hooksDir = Join-Path $parentDir '.githooks'
$psExe = (Get-Process -Id $PID).Path
$top = Invoke-Tool 'git' @('-C', $scriptsDir, 'rev-parse', '--show-toplevel')
$repoRoot = $parentDir
if ($top.Code -eq 0 -and $top.Out.Count -gt 0) { $repoRoot = $top.Out[0] }

Write-Output "test-windows: PowerShell $($PSVersionTable.PSVersion), scripts in $scriptsDir"

# 1. Tools.
$missing = @()
foreach ($t in @('git', 'node')) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { $missing += $t }
}
if ($missing.Count -gt 0) {
  Add-Result 'FAIL' 'tools' "not on PATH: $($missing -join ', ')"
  exit 1
}
$gv = Invoke-Tool 'git' @('--version')
$nv = Invoke-Tool 'node' @('--version')
Add-Result 'PASS' 'tools' "$($gv.Out[0]), node $($nv.Out[0])"

# 2. Every script parses in this PowerShell ("&&" and "??" are parse errors in 5.1).
foreach ($f in @(Get-ChildItem -LiteralPath $scriptsDir -Filter '*.ps1')) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
  if ($errors -and $errors.Count -gt 0) {
    Add-Result 'FAIL' "parse $($f.Name)" "$($errors[0].Message) (line $($errors[0].Extent.StartLineNumber))"
  } else {
    Add-Result 'PASS' "parse $($f.Name)"
  }
}

if (-not (Test-Path -LiteralPath $hooksDir)) {
  Add-Result 'FAIL' 'layout' "no .githooks folder next to $scriptsDir"
  exit 1
}

# 3. Temp repo. The space in the folder name is deliberate.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('bod selftest ' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$repo = Join-Path $tmp 'repo'
$pushed = $false
$aborted = $null

try {
  try {
    [void](New-Item -ItemType Directory -Path $repo -Force -ErrorAction Stop)
    Copy-Item -LiteralPath $scriptsDir -Destination (Join-Path $repo 'scripts') -Recurse -ErrorAction Stop
    Copy-Item -LiteralPath $hooksDir -Destination (Join-Path $repo '.githooks') -Recurse -ErrorAction Stop
    # Keep the copied tooling out of the commits, so only the test files are staged and scanned.
    Write-TextFile (Join-Path $repo '.gitignore') "scripts/`n.githooks/`n"
    Push-Location -LiteralPath $repo -ErrorAction Stop
    $pushed = $true
  } catch {
    Add-Result 'FAIL' 'setup: temp repo' "$_"
    throw
  }

  [void](Invoke-Setup 'git init' 'git' @('init', '-q', '-b', 'main'))
  # Prove git now sees the temp repo, not an outer one: at a repo top, --git-dir prints ".git".
  $gd = Invoke-Setup 'git rev-parse' 'git' @('rev-parse', '--git-dir')
  if ($gd.Out.Count -eq 0 -or $gd.Out[0] -ne '.git') {
    Add-Result 'FAIL' 'setup: temp repo is isolated' "git dir is '$($gd.Text)', expected .git"
    throw 'setup failed: temp repo is not isolated'
  }
  foreach ($kv in @(@('user.name', 'selftest'), @('user.email', 'selftest@example.invalid'), @('commit.gpgsign', 'false'), @('core.autocrlf', 'false'))) {
    [void](Invoke-Setup "git config $($kv[0])" 'git' @('config', $kv[0], $kv[1]))
  }

  $r = Invoke-Setup 'setup-hooks.mjs' 'node' @('scripts/setup-hooks.mjs')
  $hp = Invoke-Tool 'git' @('config', 'core.hooksPath')
  if ($hp.Out.Count -gt 0 -and $hp.Out[0] -eq '.githooks') {
    Add-Result 'PASS' 'setup-hooks sets core.hooksPath'
  } else {
    Add-Result 'FAIL' 'setup: setup-hooks sets core.hooksPath' (Get-Last $r)
    throw 'setup failed: hooks are not installed'
  }

  # 4. commit-msg hook.
  Write-TextFile (Join-Path $repo 'README.md') "# selftest`n"
  [void](Invoke-Tool 'git' @('add', '-A'))
  $bad = Invoke-Tool 'git' @('commit', '-q', '-m', 'update stuff')
  $head = Invoke-Tool 'git' @('rev-parse', '--verify', '--quiet', 'HEAD')
  if ($bad.Code -ne 0 -and $head.Code -ne 0 -and $bad.Text -match 'commit-msg: rejected') {
    Add-Result 'PASS' 'commit-msg rejects "update stuff"'
  } else {
    Add-Result 'FAIL' 'commit-msg rejects "update stuff"' "exit $($bad.Code): $(Get-Last $bad)"
  }
  $close = Invoke-Tool 'git' @('commit', '-q', '-m', 'fix: handle empty input', '-m', 'Fixes #12')
  if ($close.Code -ne 0) {
    Add-Result 'PASS' 'commit-msg rejects a closing keyword'
  } else {
    Add-Result 'FAIL' 'commit-msg rejects a closing keyword' 'commit went through'
  }
  $good = Invoke-Tool 'git' @('commit', '-q', '-m', 'chore: start the selftest repo')
  if ($good.Code -eq 0) {
    Add-Result 'PASS' 'commit-msg accepts a Conventional Commit'
  } else {
    Add-Result 'FAIL' 'commit-msg accepts a Conventional Commit' "exit $($good.Code): $(Get-Last $good)"
  }

  # 5. pr-size against main.
  if ($good.Code -ne 0) { throw 'setup failed: no first commit to branch from' }
  [void](Invoke-Setup 'git switch feature' 'git' @('switch', '-q', '-c', 'feature'))
  Write-TextFile (Join-Path $repo 'small.txt') ((1..20 | ForEach-Object { "line $_" }) -join "`n")
  [void](Invoke-Setup 'git add small.txt' 'git' @('add', '-A'))
  [void](Invoke-Setup 'commit small.txt' 'git' @('commit', '-q', '-m', 'feat: add a small file'))
  $small = Invoke-Tool 'node' @('scripts/check/pr-size.mjs', '--base', 'main')
  if ($small.Code -eq 0) { Add-Result 'PASS' 'pr-size passes 20 lines' }
  else { Add-Result 'FAIL' 'pr-size passes 20 lines' "exit $($small.Code): $(Get-Last $small)" }

  Write-TextFile (Join-Path $repo 'big.txt') ((1..700 | ForEach-Object { "line $_" }) -join "`n")
  [void](Invoke-Setup 'git add big.txt' 'git' @('add', '-A'))
  [void](Invoke-Setup 'commit big.txt' 'git' @('commit', '-q', '-m', 'feat: add a big file'))
  $big = Invoke-Tool 'node' @('scripts/check/pr-size.mjs', '--base', 'main')
  if ($big.Code -eq 1) { Add-Result 'PASS' 'pr-size fails 720 lines' }
  else { Add-Result 'FAIL' 'pr-size fails 720 lines' "exit $($big.Code), expected 1: $(Get-Last $big)" }
  [void](Invoke-Setup 'git switch main' 'git' @('switch', '-q', 'main'))

  # 6. cleanup-worktrees.ps1, dry run only.
  $wtMerged = Join-Path $tmp 'wt merged'
  $wtDirty = Join-Path $tmp 'wt dirty'
  [void](Invoke-Setup 'worktree add merged' 'git' @('worktree', 'add', '-q', '-b', 'merged-wt', $wtMerged, 'main'))
  [void](Invoke-Setup 'worktree add dirty' 'git' @('worktree', 'add', '-q', '-b', 'dirty-wt', $wtDirty, 'main'))
  Write-TextFile (Join-Path $wtDirty 'wip.txt') "unsaved work`n"
  $cleanup = Join-Path $scriptsDir 'cleanup-worktrees.ps1'

  $fresh = Invoke-Tool $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cleanup, '-Base', 'main')
  if ($fresh.Code -eq 0 -and $fresh.Text -notmatch 'would remove') {
    Add-Result 'PASS' 'cleanup-worktrees keeps brand-new worktrees'
  } else {
    Add-Result 'FAIL' 'cleanup-worktrees keeps brand-new worktrees' "exit $($fresh.Code): $(Get-Last $fresh 6)"
  }

  $dry = Invoke-Tool $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cleanup, '-Base', 'main', '-MinIdleHours', '0')
  $proposed = $dry.Text -match 'would remove .*wt merged'
  $keptDirty = $dry.Text -match 'keep .*wt dirty.*uncommitted'
  $stillThere = (Test-Path -LiteralPath $wtMerged) -and (Test-Path -LiteralPath $wtDirty)
  if ($dry.Code -eq 0 -and $proposed -and $keptDirty -and $stillThere) {
    Add-Result 'PASS' 'cleanup-worktrees dry run'
  } else {
    Add-Result 'FAIL' 'cleanup-worktrees dry run' "exit $($dry.Code), proposed=$proposed keptDirty=$keptDirty untouched=$stillThere : $(Get-Last $dry 6)"
  }

  # 6b. cleanup-worktrees.ps1 -Apply with ignored files. Git's own dirty check skips them.
  $wtIgnored = Join-Path $tmp 'wt ignored'
  $infoDir = Join-Path $repo '.git\info'
  [void](New-Item -ItemType Directory -Force -Path $infoDir)
  Write-TextFile (Join-Path $infoDir 'exclude') ".env`nnode_modules/`n"
  [void](Invoke-Setup 'worktree add ignored' 'git' @('worktree', 'add', '-q', '-b', 'ignored-wt', $wtIgnored, 'main'))
  Write-TextFile (Join-Path $wtIgnored '.env') "TOKEN=placeholder`n"
  [void](New-Item -ItemType Directory -Force -Path (Join-Path $wtMerged 'node_modules'))
  Write-TextFile (Join-Path $wtMerged 'node_modules\x.js') "// rebuilt by npm`n"
  $apply = Invoke-Tool $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cleanup, '-Base', 'main', '-MinIdleHours', '0', '-Apply')
  $envKept = (Test-Path -LiteralPath (Join-Path $wtIgnored '.env')) -and ($apply.Text -match 'keep .*wt ignored.*ignored files: \.env')
  $mergedGone = -not (Test-Path -LiteralPath $wtMerged)
  $dirtyKept = Test-Path -LiteralPath (Join-Path $wtDirty 'wip.txt')
  if ($apply.Code -eq 0 -and $envKept -and $mergedGone -and $dirtyKept) {
    Add-Result 'PASS' 'cleanup-worktrees -Apply keeps ignored .env, removes node_modules-only'
  } else {
    Add-Result 'FAIL' 'cleanup-worktrees -Apply keeps ignored .env, removes node_modules-only' "exit $($apply.Code), envKept=$envKept mergedGone=$mergedGone dirtyKept=$dirtyKept : $(Get-Last $apply 6)"
  }
  $forced = Invoke-Tool $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cleanup, '-Base', 'main', '-MinIdleHours', '0', '-Apply', '-Force')
  if ($forced.Code -eq 0 -and -not (Test-Path -LiteralPath $wtIgnored) -and (Test-Path -LiteralPath $wtDirty)) {
    Add-Result 'PASS' 'cleanup-worktrees -Apply -Force removes the ignored-only worktree'
  } else {
    Add-Result 'FAIL' 'cleanup-worktrees -Apply -Force removes the ignored-only worktree' "exit $($forced.Code): $(Get-Last $forced 6)"
  }

  # 7. mcp-doctor.ps1 against a fake process list, then the live one. Dry run only.
  $now = Get-Date
  $fake = @(
    @{ ProcessId = 100; ParentProcessId = 4; Name = 'Code.exe'; CommandLine = 'Code.exe'; CreationDate = $now.AddHours(-2).ToString('o') },
    @{ ProcessId = 200; ParentProcessId = 100; Name = 'node.exe'; CommandLine = 'node mcp-server-git --repo .'; CreationDate = $now.AddHours(-1).ToString('o') },
    @{ ProcessId = 300; ParentProcessId = 999; Name = 'node.exe'; CommandLine = 'node "C:\npm\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"'; CreationDate = $now.AddHours(-3).ToString('o') },
    @{ ProcessId = 301; ParentProcessId = 300; Name = 'node.exe'; CommandLine = 'node mcp-server-helper'; CreationDate = $now.AddHours(-3).ToString('o') },
    @{ ProcessId = 400; ParentProcessId = 100; Name = 'node.exe'; CommandLine = 'npx -y mcp-remote https://example.invalid/mcp'; CreationDate = $now.AddHours(-5).ToString('o') },
    @{ ProcessId = 500; ParentProcessId = 998; Name = 'uvx.exe'; CommandLine = 'uvx mcp-server-fetch'; CreationDate = $now.AddMinutes(-2).ToString('o') },
    @{ ProcessId = 600; ParentProcessId = 100; Name = 'notepad.exe'; CommandLine = 'notepad.exe notes.txt'; CreationDate = $now.AddHours(-1).ToString('o') }
  )
  $fakePath = Join-Path $tmp 'processes.json'
  Write-TextFile $fakePath (ConvertTo-Json -InputObject $fake -Depth 3)
  $doctor = Join-Path $scriptsDir 'mcp-doctor.ps1'
  $md = Invoke-Tool $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $doctor, '-ProcessJson', $fakePath)
  $want = ($md.Text -match '2 orphan\(s\)') -and ($md.Text -match 'would stop pid 300') -and ($md.Text -match 'would stop pid 400') -and ($md.Text -match 'young\s+pid 500') -and ($md.Text -notmatch 'pid 301') -and ($md.Text -notmatch 'stopped')
  if ($md.Code -eq 0 -and $want) {
    Add-Result 'PASS' 'mcp-doctor finds orphans (fake list, dry run)'
  } else {
    Add-Result 'FAIL' 'mcp-doctor finds orphans (fake list, dry run)' "exit $($md.Code): $(Get-Last $md 8)"
  }
  $live = Invoke-Tool $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $doctor)
  if ($live.Code -eq 0 -and $live.Text -match '^mcp-doctor: \d+ MCP process' -and $live.Text -notmatch 'stopped pid') {
    Add-Result 'PASS' 'mcp-doctor reads the live process list (dry run)' $live.Out[0]
  } else {
    Add-Result 'FAIL' 'mcp-doctor reads the live process list (dry run)' "exit $($live.Code): $(Get-Last $live)"
  }

  # 8. lefthook, only when it is installed. Never downloaded by this script.
  $lefthookYml = Join-Path $parentDir 'optional\lefthook.yml'
  if (-not (Test-Path -LiteralPath $lefthookYml)) { $lefthookYml = Join-Path $parentDir 'lefthook.yml' }
  $localBin = Join-Path $repoRoot 'node_modules\.bin'
  if (Test-Path -LiteralPath (Join-Path $localBin 'lefthook.cmd')) { $env:PATH = "$localBin;$env:PATH" }
  $lefthook = Get-Command lefthook -ErrorAction SilentlyContinue
  if (-not $lefthook) {
    Add-Result 'SKIP' 'lefthook' 'not installed; see docs/windows.md (this script never installs it)'
  } elseif (-not (Test-Path -LiteralPath $lefthookYml)) {
    Add-Result 'SKIP' 'lefthook' 'no lefthook.yml or optional\lefthook.yml next to scripts'
  } else {
    Copy-Item -LiteralPath $lefthookYml -Destination (Join-Path $repo 'lefthook.yml')
    $lh = Invoke-Tool 'node' @('scripts/setup-hooks.mjs')
    $hp2 = Invoke-Tool 'git' @('config', 'core.hooksPath')
    Write-TextFile (Join-Path $repo 'lh.txt') "lefthook`n"
    [void](Invoke-Tool 'git' @('add', '-A'))
    $lhBad = Invoke-Tool 'git' @('commit', '-q', '-m', 'update stuff')
    $lhGood = Invoke-Tool 'git' @('commit', '-q', '-m', 'chore: commit through lefthook')
    if ($lh.Code -eq 0 -and $hp2.Code -ne 0 -and $lhBad.Code -ne 0 -and $lhGood.Code -eq 0) {
      Add-Result 'PASS' 'lefthook runs the commit-msg check'
    } else {
      Add-Result 'FAIL' 'lefthook runs the commit-msg check' "setup exit $($lh.Code), hooksPath still set=$($hp2.Code -eq 0), bad exit $($lhBad.Code), good exit $($lhGood.Code): $(Get-Last $lh)"
    }
  }
} catch {
  $aborted = "$_"
} finally {
  if ($pushed) { Pop-Location }
  if ($Keep) {
    Write-Output "test-windows: kept $tmp"
  } else {
    # Only when the temp repo exists: otherwise git -C would search upward for another repo.
    if (Test-Path -LiteralPath (Join-Path $repo '.git')) {
      [void](Invoke-Tool 'git' @('-C', $repo, 'worktree', 'remove', '--force', (Join-Path $tmp 'wt merged')))
      [void](Invoke-Tool 'git' @('-C', $repo, 'worktree', 'remove', '--force', (Join-Path $tmp 'wt dirty')))
      [void](Invoke-Tool 'git' @('-C', $repo, 'worktree', 'remove', '--force', (Join-Path $tmp 'wt ignored')))
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($aborted) {
  Write-Output "ABORT test-windows: $aborted. Later checks did not run."
  exit 1
}

$fails = @($script:results | Where-Object { $_ -eq 'FAIL' }).Count
$passes = @($script:results | Where-Object { $_ -eq 'PASS' }).Count
$skips = @($script:results | Where-Object { $_ -eq 'SKIP' }).Count
Write-Output "test-windows: $passes passed, $fails failed, $skips skipped"
if ($fails -gt 0) { exit 1 }
exit 0
