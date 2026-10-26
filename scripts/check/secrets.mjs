#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Secret and personal-path scan (RULES.md R12).
//
//   node scripts/check/secrets.mjs --staged   added lines in the index (pre-commit)
//   node scripts/check/secrets.mjs --all      every tracked file as checked out (CI)
//
// File names are always checked, even for binary and empty files (cert.p12, an empty
// .env), and come from git -z output, so spaces and non-ASCII names are safe.
//
// Uses gitleaks when it is on PATH, and always runs the built-in patterns below,
// because gitleaks does not know about personal paths. A line ending in a
// "gitleaks:allow" comment is skipped by both. Exit 0 clean, 1 findings, 2 git error.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['OpenAI or Anthropic key', /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['xAI key', /\bxai-[A-Za-z0-9]{40,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ['JWT (Supabase keys are JWTs too)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['personal Windows path', /\b[A-Za-z]:[\\/]+Users[\\/]+(?!(Public|Default|<|\.\.\.|…|%))[^\\/\s"'`<>]+/i],
  // Any case: macOS paths are case-insensitive, and capitalised user names are common.
  ['personal home path', /(?<![\w.])\/(Users|home)\/(?!((runner|node|user)\/|<|\.\.\.|…|\$))[a-z][\w.-]+\//i],
];
// Case-insensitive: Windows and macOS treat .ENV and cert.P12 as the same files.
export const BAD_FILES = [/(^|\/)\.env(\.(?!example$|sample$|template$)[\w.-]+)?$/i, /\.(pem|p12|pfx|key)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)$/i];
const ALLOW = /gitleaks:allow/;

/** Returns findings for one file's lines: { file, line, rule }. Never returns the secret itself. */
export function scanLines(file, lines) {
  const findings = [];
  if (BAD_FILES.some((re) => re.test(file))) findings.push({ file, line: 0, rule: 'file that should never be committed' });
  lines.forEach(([no, text]) => {
    if (ALLOW.test(text)) return;
    for (const [rule, re] of PATTERNS) if (re.test(text)) findings.push({ file, line: no, rule });
  });
  return findings;
}

/**
 * Parses `git diff --cached -U0 --no-renames` into Map(file -> [[lineNo, text]]).
 * `names` is the same diff's `--name-only -z` list, in the same order. Each
 * "diff --git" header starts the next name, so the "+++ b/path" line is never parsed
 * (it is quoted or tab-suffixed for unusual names). "--- " and "+++ " are headers only
 * before the first "@@" of a file; inside a hunk, "+++ x" is an added line "++ x".
 * Binary and empty files have no hunks and map to [], so their names are still checked.
 */
export function addedLines(diff, names) {
  const files = new Map();
  let i = -1;
  let inHunk = false;
  let no = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      i += 1;
      if (i >= names.length) throw new Error('diff has more files than --name-only');
      files.set(names[i], []);
      inHunk = false;
    } else if (i >= 0 && line.startsWith('@@')) {
      no = Number(/\+(\d+)/.exec(line)[1]);
      inHunk = true;
    } else if (inHunk && line.startsWith('+')) {
      files.get(names[i]).push([no++, line.slice(1)]);
    }
  }
  if (i + 1 !== names.length) throw new Error(`diff lists ${i + 1} files, --name-only lists ${names.length}`);
  return files;
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function collect(mode) {
  if (mode === '--staged') {
    const opts = ['diff', '--cached', '--no-renames', '--diff-filter=ACM', '--no-color', '--no-ext-diff', '--no-textconv'];
    const names = git([...opts, '--name-only', '-z']).split('\0').filter(Boolean);
    return addedLines(git([...opts, '-U0']), names);
  }
  const files = new Map();
  for (const file of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; } // deleted in the worktree
    if (text.includes('\0')) { files.set(file, []); continue; } // binary: check the name only
    files.set(file, text.split('\n').map((t, i) => [i + 1, t]));
  }
  return files;
}

function gitleaks(mode) {
  // --all scans the checked-out files (gitleaks >= 8.19 "dir"), not the whole history.
  const args = mode === '--staged' ? ['git', '--pre-commit', '--staged', '--redact', '--no-banner'] : ['dir', '.', '--redact', '--no-banner'];
  const r = spawnSync('gitleaks', args, { stdio: 'inherit' });
  if (r.error) return 'missing';
  return r.status === 0 ? 'pass' : 'fail';
}

function main(argv) {
  const mode = argv[0];
  if (mode !== '--staged' && mode !== '--all') {
    console.error('secrets: usage: node scripts/check/secrets.mjs --staged|--all');
    return 2;
  }
  let files;
  try { files = collect(mode); } catch (err) { console.error(`secrets: could not list changes: ${err.message.split('\n')[0]}`); return 2; }
  const findings = [...files].flatMap(([file, lines]) => scanLines(file, lines));
  for (const f of findings) console.error(`secrets: ${f.file}${f.line ? `:${f.line}` : ''}: ${f.rule}`);
  const leaks = process.env.SECRETS_SKIP_GITLEAKS ? 'skipped' : gitleaks(mode);
  if (leaks === 'missing') console.log('secrets: gitleaks not on PATH; built-in patterns only. Install it for full coverage.');
  const ok = findings.length === 0 && leaks !== 'fail';
  console.log(`secrets: ${ok ? 'pass' : 'fail'} (${files.size} files, built-in findings: ${findings.length}, gitleaks: ${leaks})`);
  if (!ok) console.error('secrets: remove the value and rotate it if it was real. Mark a known test value with a gitleaks:allow comment.');
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main(process.argv.slice(2));
}
