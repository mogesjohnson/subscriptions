<#
.SYNOPSIS
  BEST-OF-AI-DEV template v1. Lists agent worktrees that are safe to remove, and removes them with -Apply.

.DESCRIPTION
  Windows PowerShell 5.1 compatible: no "&&", no "??", no ternary. Quote every path,
  because profile folders can contain spaces ("First Last").

  A worktree is a removal candidate when:
    - its folder is gone (git lists it as prunable), or
    - its branch is already merged into -Base, or
    - its last commit is older than -StaleDays.
  Any worktree touched in the last -MinIdleHours is kept, so a brand-new agent worktree
  (no commits yet, so technically merged) is never a candidate.
  It is always kept when it has uncommitted or untracked changes, is locked, or is the
  main worktree. Removal uses "git worktree remove" without --force, so Git refuses
  anything it considers dirty, even if this script got it wrong.

  Git does NOT count ignored files as dirty: "git worktree remove" deletes a .env or a local
  database without asking. So this script lists ignored files and keeps the worktree unless
  you pass -Force. Ignored folders named in -Disposable (node_modules, dist and other build
  output) do not count, because they can be rebuilt. Ignored files never match -Disposable.

  "Merged" means the branch tip is an ancestor of -Base. A squash or rebase merge leaves no
  ancestor, so those branches show up only once they pass -StaleDays. Run git fetch first
  so origin/main is current.

  Dry run is the default. Nothing changes without -Apply.
  Exit 0 done, 1 a removal failed, 2 not in a git repo or bad arguments.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-worktrees.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-worktrees.ps1 -Apply -DeleteBranches
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-worktrees.ps1 -Apply -Force
  Also removes worktrees whose only leftovers are ignored files. Read the dry run first.
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [int]$StaleDays = 14,
  [int]$MinIdleHours = 24,
  [string]$Base = 'origin/main',
  [switch]$DeleteBranches,
  [switch]$Force,
  [string[]]$Disposable = @('node_modules', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache', 'target', '__pycache__')
)

$ErrorActionPreference = 'Continue'

function Invoke-Git {
  param([string[]]$GitArgs)
  # 2>&1 turns git's stderr into ErrorRecords; "$_" makes them plain text again.
  # Build the array by hand: @() around an empty pipeline is not reliably empty in 5.1.
  $lines = New-Object System.Collections.ArrayList
  & git @GitArgs 2>&1 | ForEach-Object { [void]$lines.Add("$_") }
  return New-Object PSObject -Property @{ Code = $LASTEXITCODE; Out = $lines.ToArray() }
}

$top = Invoke-Git @('rev-parse', '--show-toplevel')
if ($top.Code -ne 0) {
  Write-Output 'cleanup-worktrees: not inside a git repository'
  exit 2
}
$baseCheck = Invoke-Git @('rev-parse', '--verify', '--quiet', "$Base^{commit}")
if ($baseCheck.Code -ne 0) {
  Write-Output "cleanup-worktrees: base '$Base' not found. Pass -Base main, or run git fetch."
  exit 2
}

# Parse "git worktree list --porcelain": blank-line separated records.
$list = Invoke-Git @('worktree', 'list', '--porcelain')
$records = @()
$current = $null
foreach ($line in $list.Out) {
  if ($line -like 'worktree *') {
    if ($current) { $records += $current }
    $current = @{ Path = $line.Substring(9); Branch = ''; Head = ''; Locked = $false; Prunable = $false }
  } elseif ($null -ne $current) {
    if ($line -like 'branch *') { $current.Branch = $line.Substring(7) -replace '^refs/heads/', '' }
    elseif ($line -like 'HEAD *') { $current.Head = $line.Substring(5) }
    elseif ($line -like 'locked*') { $current.Locked = $true }
    elseif ($line -like 'prunable*') { $current.Prunable = $true }
  }
}
if ($current) { $records += $current }

$mode = 'dry run'
if ($Apply) { $mode = 'apply' }
Write-Output "cleanup-worktrees: $($records.Count) worktree(s), base $Base, stale after $StaleDays day(s), $mode"

$failed = 0
$candidates = 0
$keptIgnored = 0
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
for ($i = 0; $i -lt $records.Count; $i++) {
  $wt = $records[$i]
  $label = $wt.Path
  if ($wt.Branch) { $label = "$($wt.Path) [$($wt.Branch)]" }

  if ($i -eq 0) { Write-Output "  keep    $label (main worktree)"; continue }
  if ($wt.Path -eq $top.Out[0]) { Write-Output "  keep    $label (current worktree)"; continue }
  if ($wt.Locked) { Write-Output "  keep    $label (locked)"; continue }

  $reason = ''
  if ($wt.Prunable -or -not (Test-Path -LiteralPath $wt.Path)) {
    $reason = 'folder is gone'
  } else {
    $dirty = Invoke-Git @('-C', $wt.Path, 'status', '--porcelain')
    if ($dirty.Code -ne 0) { Write-Output "  keep    $label (git status failed)"; continue }
    if (@($dirty.Out | Where-Object { $_.Trim() }).Count -gt 0) {
      Write-Output "  keep    $label (uncommitted changes)"
      continue
    }
    # Last activity is the newer of the last commit and the worktree's own HEAD reflog,
    # so a worktree created a minute ago (no commits yet, so "merged") is not removed.
    $last = 0
    foreach ($fmt in @(@('log', '-1', '--format=%ct'), @('log', '-g', '-1', '--format=%gd', '--date=unix'))) {
      $t = Invoke-Git (@('-C', $wt.Path) + $fmt)
      # %ct prints 1792950638; the reflog selector prints HEAD@{1792950638}.
      if ($t.Code -eq 0 -and $t.Out.Count -gt 0 -and $t.Out[0] -match '(\d{9,})') {
        if ([long]$Matches[1] -gt $last) { $last = [long]$Matches[1] }
      }
    }
    $idleHours = [int](($now - $last) / 3600)
    if ($idleHours -lt $MinIdleHours) {
      Write-Output "  keep    $label (active $idleHours hour(s) ago)"
      continue
    }
    $merged = Invoke-Git @('merge-base', '--is-ancestor', $wt.Head, $Base)
    if ($merged.Code -eq 0) {
      $reason = "merged into $Base"
    } elseif ($idleHours -ge ($StaleDays * 24)) {
      $reason = "idle $([int]($idleHours / 24)) day(s), not merged"
    }
  }

  if (-not $reason) { Write-Output "  keep    $label (active)"; continue }

  # Ignored files are deleted by "git worktree remove", so they count as dirty here.
  $ignored = New-Object System.Collections.ArrayList
  if ($reason -ne 'folder is gone') {
    $ign = Invoke-Git @('-C', $wt.Path, 'status', '--porcelain', '--ignored')
    if ($ign.Code -ne 0) { Write-Output "  keep    $label (git status --ignored failed)"; continue }
    foreach ($l in $ign.Out) {
      if ($l -notlike '!! *') { continue }
      $p = $l.Substring(3).Trim('"')
      $leaf = @($p.TrimEnd('/') -split '/')[-1]
      if ($p.EndsWith('/') -and ($Disposable -contains $leaf)) { continue }
      [void]$ignored.Add($p)
    }
  }
  if ($ignored.Count -gt 0) {
    $shown = @($ignored | Select-Object -First 5) -join ', '
    if ($ignored.Count -gt 5) { $shown = "$shown and $($ignored.Count - 5) more" }
    if (-not $Force) {
      Write-Output "  keep    $label ($reason, but has ignored files: $shown. -Force removes them too)"
      $keptIgnored++
      continue
    }
    $reason = "$reason; deletes ignored files: $shown"
  }
  $candidates++
  if (-not $Apply) { Write-Output "  would remove $label ($reason)"; continue }

  if ($reason -eq 'folder is gone') {
    $r = Invoke-Git @('worktree', 'prune')
  } else {
    $r = Invoke-Git @('worktree', 'remove', $wt.Path)
  }
  if ($r.Code -ne 0) {
    $failed++
    Write-Output "  FAILED  $label : $($r.Out -join ' ')"
    continue
  }
  Write-Output "  removed $label ($reason)"
  # Only merged branches are deleted, and only with -d, which refuses unmerged work.
  if ($DeleteBranches -and $wt.Branch -and $reason -like 'merged*') {
    $d = Invoke-Git @('branch', '-d', $wt.Branch)
    if ($d.Code -eq 0) { Write-Output "          deleted branch $($wt.Branch)" }
    else { Write-Output "          kept branch $($wt.Branch): $($d.Out -join ' ')" }
  }
}

if (-not $Apply -and $candidates -gt 0) {
  Write-Output "cleanup-worktrees: $candidates candidate(s). Run again with -Apply to remove them."
}
if ($keptIgnored -gt 0) {
  Write-Output "cleanup-worktrees: kept $keptIgnored worktree(s) only for ignored files. Check them, then add -Force."
}
if ($failed -gt 0) { exit 1 }
exit 0
