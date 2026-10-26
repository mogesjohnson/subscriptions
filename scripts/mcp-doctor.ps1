<#
.SYNOPSIS
  BEST-OF-AI-DEV template v1. Finds MCP server processes whose agent is gone, and stops them with -Apply.

.DESCRIPTION
  Windows PowerShell 5.1 compatible: no "&&", no "??", no ternary.

  Agents start MCP servers as child processes (node, npx, uvx, python, docker). When the
  agent crashes or its terminal is closed, the servers often keep running, holding ports,
  file locks and memory. This script lists processes whose command line matches -Pattern and
  calls one an orphan when its parent process is gone, or when the parent PID now belongs to
  a newer process (Windows reuses PIDs). Processes younger than -MinAgeMinutes are left alone.
  Command lines matching -Exclude are never touched; the default skips this script and any
  agent started with --mcp-* flags, which would otherwise look like a server.

  Dry run is the default. -Apply runs "taskkill /PID <pid> /T /F" on each orphan, which also
  stops the server's own children.
  -ProcessJson reads a JSON array of {ProcessId, ParentProcessId, Name, CommandLine,
  CreationDate} instead of the live process list. The Windows self-test uses it.
  Exit 0 done, 1 a stop failed, 2 the process list could not be read.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\mcp-doctor.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\mcp-doctor.ps1 -Apply
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [int]$MinAgeMinutes = 10,
  [string]$Pattern = '(?i)(modelcontextprotocol|mcp-server|server-mcp|mcp-remote|mcp[-_]proxy|[\\/ ]mcp[\\/ ]|\w-mcp(\.exe)?\b)',
  # Agents themselves take --mcp-* flags (claude --mcp-config). Never treat them as servers.
  [string]$Exclude = '(?i)(mcp-doctor|--mcp-)',
  [string]$ProcessJson = ''
)

$ErrorActionPreference = 'Continue'

# System processes have no CreationDate; treat a missing time as "very old".
function ConvertTo-Time {
  param($Value)
  if ($Value) { return [datetime]$Value }
  return [datetime]::MinValue
}

$procs = @()
if ($ProcessJson) {
  if (-not (Test-Path -LiteralPath $ProcessJson)) {
    Write-Output "mcp-doctor: $ProcessJson not found"
    exit 2
  }
  # Assign first, then enumerate: in 5.1, ConvertFrom-Json emits an array as one object.
  $parsed = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($ProcessJson))
  foreach ($p in $parsed) {
    $procs += New-Object PSObject -Property @{
      ProcessId = [int]$p.ProcessId; ParentProcessId = [int]$p.ParentProcessId
      Name = "$($p.Name)"; CommandLine = "$($p.CommandLine)"; CreationDate = (ConvertTo-Time $p.CreationDate)
    }
  }
} else {
  try {
    $procs = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
      Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate)
  } catch {
    Write-Output "mcp-doctor: cannot read the process list ($($_.Exception.Message)). Windows only."
    exit 2
  }
}

$byId = @{}
foreach ($p in $procs) { $byId[[int]$p.ProcessId] = $p }

$self = $PID
$now = Get-Date
$mcp = @()
foreach ($p in $procs) {
  if (-not $p.CommandLine) { continue }          # other users' processes, unless elevated
  if ([int]$p.ProcessId -eq $self) { continue }
  if ($p.CommandLine -match $Exclude) { continue }
  if ($p.CommandLine -match $Pattern) { $mcp += $p }
}

# Only the top of each MCP tree is reported: a child whose parent is also an MCP process
# goes away with it (taskkill /T).
$mcpIds = @{}
foreach ($p in $mcp) { $mcpIds[[int]$p.ProcessId] = $true }

$orphans = @()
$lines = @()
foreach ($p in $mcp) {
  $id = [int]$p.ProcessId
  $parentId = [int]$p.ParentProcessId
  if ($mcpIds.ContainsKey($parentId)) { continue }
  $ageMin = [int]($now - (ConvertTo-Time $p.CreationDate)).TotalMinutes
  $cmd = $p.CommandLine
  if ($cmd.Length -gt 120) { $cmd = $cmd.Substring(0, 117) + '...' }
  $parent = $byId[$parentId]
  $state = ''
  if ($null -eq $parent) {
    $state = "parent $parentId gone"
  } elseif ((ConvertTo-Time $parent.CreationDate) -gt (ConvertTo-Time $p.CreationDate)) {
    $state = "parent PID $parentId reused by $($parent.Name)"
  }
  if (-not $state) {
    $lines += "  ok      pid $id $($p.Name), parent $parentId $($parent.Name): $cmd"
  } elseif ($ageMin -lt $MinAgeMinutes) {
    $lines += "  young   pid $id $($p.Name), $state, $ageMin min old: $cmd"
  } else {
    $orphans += $p
    $lines += "  orphan  pid $id $($p.Name), $state, $ageMin min old: $cmd"
  }
}

$mode = 'dry run'
if ($Apply) { $mode = 'apply' }
Write-Output "mcp-doctor: $($mcp.Count) MCP process(es), $($orphans.Count) orphan(s), $mode"
foreach ($l in $lines) { Write-Output $l }

$failed = 0
foreach ($p in $orphans) {
  $id = [int]$p.ProcessId
  if (-not $Apply) { Write-Output "  would stop pid $id"; continue }
  $out = & taskkill.exe /PID $id /T /F 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -eq 0) { Write-Output "  stopped pid $id" }
  else { $failed++; Write-Output "  FAILED  pid $id : $($out -join ' ')" }
}
if (-not $Apply -and $orphans.Count -gt 0) {
  Write-Output 'mcp-doctor: run again with -Apply to stop the orphans.'
}
if ($failed -gt 0) { exit 1 }
exit 0
