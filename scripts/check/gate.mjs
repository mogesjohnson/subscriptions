#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Runs one PR gate for pr-checks.yml (RULES.md R15).
//
//   node gate.mjs <checker.mjs> [args...]
//
// Always runs the BASE commit's copy of the checker, from $BASE_CHECKS. A PR can't loosen a gate
// by editing it, because its edit never runs in place of the base copy.
// The checker-change path only softens a failure: with the `checker-change` label, a
// "Checker change: <why>" line in the PR body, and a diff to THIS checker's file, a base-copy
// failure becomes a warning. The PR's own copy then has to pass too. Any other checker keeps
// failing as usual, so the label can't wave through an unrelated gate.
// Env: BASE_SHA, HEAD_SHA, SCRIPTS (repo path of scripts/), BASE_CHECKS, PR_LABELS, PR_BODY.
// Exit: the checker's status, or 1 when the label is set without its line or checker diff.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINE = /^Checker change: *\S/m;

export function hasLabel(labels, name) {
  return String(labels || '').split(',').map((s) => s.trim()).includes(name);
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

/** True when the PR changes this checker's file (or the PR adds it). */
export function checkerChanged(env, checker) {
  const path = `${env.SCRIPTS}/check/${checker}`;
  const r = git(['diff', '--quiet', `${env.BASE_SHA}...${env.HEAD_SHA}`, '--', path]);
  return r.status === 1;
}

/** True when the PR changes any file under $SCRIPTS/check/. */
function anyCheckerChanged(env) {
  const r = git(['diff', '--quiet', `${env.BASE_SHA}...${env.HEAD_SHA}`, '--', `${env.SCRIPTS}/check/`]);
  return r.status === 1;
}

function run(dir, checker, args) {
  const r = spawnSync(process.execPath, [join(dir, checker), ...args], { stdio: 'inherit' });
  return r.status ?? 1;
}

export function gate(checker, args, env = process.env, log = console) {
  const labelled = hasLabel(env.PR_LABELS, 'checker-change');
  if (labelled && !(LINE.test(env.PR_BODY || '') && anyCheckerChanged(env))) {
    log.error(`::error::checker-change needs a "Checker change:" line and a change under ${env.SCRIPTS}/check/`);
    return 1;
  }
  const base = run(env.BASE_CHECKS, checker, args);
  if (base === 0) return 0;
  if (!labelled || !checkerChanged(env, checker)) return base;
  log.error(`::warning::checker-change: the base ${checker} failed; this PR changes it, so running the PR's copy. A reviewer must read the checker diff.`);
  return run(join(env.SCRIPTS, 'check'), checker, args);
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [checker, ...args] = process.argv.slice(2);
  if (!checker || !/^[\w-]+\.mjs$/.test(checker)) {
    console.error('usage: node gate.mjs <checker.mjs> [args...]');
    process.exit(2);
  }
  process.exit(gate(checker, args));
}
