#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Runs the local checks for one hook and reports each one.
//
//   node scripts/hooks/run-checks.mjs pre-commit|pre-push
//
// Called by .githooks/ (default) or lefthook (optional/lefthook.yml). Every check runs,
// even after a failure, so one run shows everything that is wrong. "{scripts}" in a
// command is this scripts/ directory, so the same list works in any layout.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutGitEnv } from '../lib/git-env.mjs';

// Template checks. Keep them: they are the floor, not a suggestion.
const FLOOR = {
  // gitEnv: the staged scan must see GIT_INDEX_FILE ("git commit <path>" uses a temp index).
  'pre-commit': [{ name: 'secrets', run: 'node {scripts}/check/secrets.mjs --staged', gitEnv: true }],
  // stdin: gets the refs git is pushing, so "git push origin other-branch" checks other-branch.
  'pre-push': [{ name: 'pr size', run: 'node {scripts}/check/pr-size.mjs --stdin-refs', blockedExit: 2, stdin: true }],
};

// REPO-SPECIFIC: your repo's fast checks. pre-commit should stay under ~10 seconds;
// put slow suites in pre-push. "npm run x --if-present" is a no-op when x is missing;
// "needs" skips the check when that file is absent (no package.json, no npm).
const REPO = {
  'pre-commit': [{ name: 'lint', run: 'npm run lint --if-present', needs: 'package.json' }],
  'pre-push': [
    { name: 'types', run: 'npm run typecheck --if-present', needs: 'package.json' },
    { name: 'tests', run: 'npm run test --if-present', needs: 'package.json' },
  ],
};
// /REPO-SPECIFIC

export function plan(hook, scriptsDir) {
  return [...(FLOOR[hook] || []), ...(REPO[hook] || [])].map((c) => ({ ...c, run: c.run.replaceAll('{scripts}', scriptsDir) }));
}

/** Hook variables (GIT_DIR, GIT_INDEX_FILE...) reach only checks that ask for them. */
export function checkEnv(check, env = process.env) {
  return check.gitEnv ? { ...env } : withoutGitEnv(env);
}

/** exit 0 pass; the check's blockedExit code means it could not run (reported, not fatal). */
export function verdict(check, status) {
  if (status === 0) return 'pass';
  if (check.blockedExit !== undefined && status === check.blockedExit) return 'blocked';
  return 'fail';
}

/** git feeds pre-push the refs being pushed on stdin. Read it once; a manual run has none. */
function hookInput(hook) {
  if (hook !== 'pre-push' || process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function main(argv) {
  const hook = argv[0];
  if (!FLOOR[hook]) {
    console.error('run-checks: usage: node scripts/hooks/run-checks.mjs pre-commit|pre-push');
    return 2;
  }
  const scripts = relative(process.cwd(), fileURLToPath(new URL('..', import.meta.url))).split('\\').join('/') || '.';
  const input = hookInput(hook);
  const results = [];
  for (const check of plan(hook, scripts)) {
    if (check.needs && !existsSync(check.needs)) {
      console.log(`${hook}: skipped ${check.name} (no ${check.needs})`);
      continue;
    }
    const started = Date.now();
    const io = check.stdin ? { input, stdio: ['pipe', 'inherit', 'inherit'] } : { stdio: 'inherit' };
    const r = spawnSync(check.run, { shell: true, ...io, env: checkEnv(check) });
    const v = verdict(check, r.status ?? 1);
    results.push(v);
    console.log(`${hook}: ${v.padEnd(7)} ${check.name} (${Date.now() - started} ms)`);
  }
  if (results.includes('fail')) {
    console.error(`${hook}: fix the failures above. Never bypass with --no-verify (RULES.md R5).`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main(process.argv.slice(2));
}
