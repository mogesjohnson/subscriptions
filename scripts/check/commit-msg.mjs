#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Usage: node scripts/check/commit-msg.mjs <message-file>
// Called by .githooks/commit-msg. Exit 1 rejects the commit.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkMessage } from './commit-format.mjs';

const file = process.argv[2];
if (!file) {
  console.error('commit-msg: missing message file argument');
  process.exit(2);
}
// Honor core.commentChar so a repo that changed it is not misread.
const cfg = spawnSync('git', ['config', '--get', 'core.commentChar'], { encoding: 'utf8' });
const commentChar = cfg.status === 0 ? cfg.stdout.trim() : '#';
const problems = checkMessage(readFileSync(file, 'utf8'), commentChar);
if (problems.length) {
  console.error('commit-msg: rejected');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('  example: feat(api): add retry budget');
  console.error('  Fix the message. Never bypass with --no-verify (RULES.md R5).');
  process.exit(1);
}
