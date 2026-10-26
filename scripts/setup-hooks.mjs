#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Points Git at the versioned hooks in .githooks/.
// Runs from "npm install" (the prepare script in package.json) or by hand. Safe to run twice.
// Worktrees share this setting, so every agent worktree gets the same hooks.
// If the repo root has lefthook.yml (see optional/lefthook.yml), lefthook must be
// installed: then it clears core.hooksPath and runs "lefthook install". If lefthook is
// missing or fails, it exits 1 and leaves .githooks/ active, so a repo never ends up
// with no hooks at all. Skipped when CI is set: hooks do not run in CI, the gates do.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

let top;
try {
  top = git(['rev-parse', '--show-toplevel']);
} catch {
  console.log('setup-hooks: not a git checkout, skipped');
  process.exit(0);
}
if (process.env.CI) {
  console.log('setup-hooks: CI is set, skipped (CI runs the same checks as gates)');
  process.exit(0);
}

function useGithooks() {
  const dir = join(top, '.githooks');
  if (!existsSync(dir)) {
    console.error('setup-hooks: .githooks/ not found');
    return false;
  }
  for (const name of readdirSync(dir)) {
    try {
      chmodSync(join(dir, name), 0o755);
    } catch {
      // Windows ignores modes; Git for Windows runs hooks without them.
    }
  }
  git(['config', 'core.hooksPath', '.githooks']);
  console.log(`setup-hooks: core.hooksPath = .githooks (${readdirSync(dir).join(', ')})`);
  return true;
}

if (existsSync(join(top, 'lefthook.yml'))) {
  const win = process.platform === 'win32';
  const local = join(top, 'node_modules', '.bin', win ? 'lefthook.cmd' : 'lefthook');
  const bin = existsSync(local) ? local : 'lefthook';
  // .cmd shims need a shell on Windows; quote the path because user folders contain spaces.
  const lh = (args, stdio) => spawnSync(win ? `"${bin}"` : bin, args, { cwd: top, stdio, shell: win });
  const found = lh(['version'], 'ignore').status === 0;
  let installed = false;
  if (found) {
    // lefthook refuses to install while core.hooksPath is set.
    try { git(['config', '--unset', 'core.hooksPath']); } catch { /* not set */ }
    installed = lh(['install'], 'inherit').status === 0;
  }
  if (installed) {
    console.log('setup-hooks: lefthook installed the hooks from lefthook.yml');
    process.exit(0);
  }
  const kept = useGithooks();
  console.error(`setup-hooks: FAIL: lefthook.yml is present but lefthook ${found ? 'install failed' : 'is not installed'}.`);
  console.error(`  ${kept ? 'Kept .githooks/ active so commits are still checked.' : 'No hooks are active.'}`);
  console.error('  Fix one of these:');
  console.error('  - Delete lefthook.yml to use .githooks/ (the default).');
  console.error('  - Add lefthook as a dev dependency. That is a new dependency: ask first (RULES.md R3).');
  console.error('    With no package.json yet, run "npm init -y" first. Installing lefthook does not');
  console.error('    rerun this script, so run "node scripts/setup-hooks.mjs" again yourself.');
  process.exit(1);
}

process.exit(useGithooks() ? 0 : 1);
