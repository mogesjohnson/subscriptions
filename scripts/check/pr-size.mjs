#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. PR size gate (RULES.md R8). Counts changed lines, never commits.
//
//   node scripts/check/pr-size.mjs [--base <ref>] [--stdin-refs]   default base: origin/main
//
// --stdin-refs reads git's pre-push input and checks each pushed branch instead of HEAD.
//
// Counts added + deleted lines in `git diff BASE...HEAD`, so later commits that undo earlier
// ones do not inflate the total. Excludes lockfiles, generated files and, in a repo with a
// template/ mirror, root files byte-identical to their template/ copy.
// Exception: label "size-exception" plus a "Size exception: <reason>" line in the PR body
// (CI reads PR_LABELS and PR_BODY). SIZE_EXCEPTION="<reason>" works for a local push only.
// PR_SIZE_LIMIT and PR_SIZE_TARGET can lower the numbers for one run, never raise them.
// Exit 0 pass, 1 over the limit, 2 usage or git error.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// REPO-SPECIFIC: the hard limit and soft target. Change them here, in review, not per run.
const MAX_LIMIT = 600;
const MAX_TARGET = 400;
// /REPO-SPECIFIC

/** An env override can only tighten a number, never loosen it. */
export function tighten(value, max) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < max ? n : max;
}
export const LIMIT = tighten(process.env.PR_SIZE_LIMIT, MAX_LIMIT);
export const TARGET = Math.min(tighten(process.env.PR_SIZE_TARGET, MAX_TARGET), LIMIT);

export const EXCLUDE = [
  '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lockb', '**/Cargo.lock',
  '**/poetry.lock', '**/uv.lock', '**/Gemfile.lock', '**/go.sum', '**/composer.lock',
  '**/*.min.js', '**/*.min.css', '**/*.map', '**/generated/**', 'evidence/**',
  // REPO-SPECIFIC: extra excluded globs, one per line, each with a reason comment.
  // /REPO-SPECIFIC
];
const MIRROR_DIR = 'template';

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const EXCLUDE_RE = EXCLUDE.map(globToRegExp);
export const isExcluded = (path) => EXCLUDE_RE.some((re) => re.test(path));

/** Parses `git diff --numstat -z` output into { path, added, deleted, binary }. */
export function parseNumstat(out) {
  const parts = out.split('\0');
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const [added, deleted, path] = parts[i].split('\t');
    let file = path;
    if (path === '') { i += 2; file = parts[i]; } // rename: old and new paths follow
    rows.push({ path: file, added: added === '-' ? 0 : Number(added), deleted: deleted === '-' ? 0 : Number(deleted), binary: added === '-' });
  }
  return rows;
}

export function exceptionReason(env) {
  // SIZE_EXCEPTION lets a local push through; CI ignores it and needs the label and the line.
  const ci = Boolean(env.CI || env.GITHUB_ACTIONS);
  if (!ci && env.SIZE_EXCEPTION && env.SIZE_EXCEPTION.trim().length >= 10) return `${env.SIZE_EXCEPTION.trim()} (local only; the PR still needs the label)`;
  const labelled = (env.PR_LABELS || '').split(',').map((s) => s.trim()).includes('size-exception');
  // Same line only, and not inside an HTML comment (the PR template's example is one).
  const body = (env.PR_BODY || '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const m = /^Size exception:[ \t]*(\S.{9,})$/im.exec(body);
  return labelled && m ? m[1].trim() : null;
}

export function summarize(rows, isMirror = () => false) {
  const counted = [];
  const skipped = [];
  for (const r of rows) (isExcluded(r.path) || isMirror(r.path) ? skipped : counted).push(r);
  const added = counted.reduce((n, r) => n + r.added, 0);
  const deleted = counted.reduce((n, r) => n + r.deleted, 0);
  return { added, deleted, total: added + deleted, files: counted.length, skipped, binaries: counted.filter((r) => r.binary) };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function mirrorCheck(head) {
  let tree;
  try { tree = git(['ls-tree', '-r', head]); } catch { return () => false; }
  const blobs = new Map();
  for (const line of tree.split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m) blobs.set(m[2], m[1]);
  }
  return (path) => !path.startsWith(`${MIRROR_DIR}/`) && blobs.has(`${MIRROR_DIR}/${path}`) && blobs.get(path) === blobs.get(`${MIRROR_DIR}/${path}`);
}

function resolves(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses pre-push stdin ("<local ref> <local sha> <remote ref> <remote sha>" per line) into the
 * branch tips being pushed. Deletions and tags are skipped.
 */
export function pushedTips(input) {
  const tips = [];
  for (const line of input.split(/\r?\n/)) {
    const [localRef, localSha] = line.trim().split(/\s+/);
    if (!localSha || /^0+$/.test(localSha) || localRef.startsWith('refs/tags/')) continue;
    tips.push({ ref: localRef.replace(/^refs\/heads\//, ''), sha: localSha });
  }
  return tips;
}

function checkRange(base, head, label) {
  let rows;
  try {
    rows = parseNumstat(git(['diff', '--numstat', '-z', '-M', `${base}...${head}`]));
  } catch (err) {
    console.error(`pr-size: cannot diff ${base}...${label}. (${err.message.split('\n')[0]})`);
    return 2;
  }
  const s = summarize(rows, mirrorCheck(head));
  const verdict = s.total > LIMIT ? 'fail' : s.total > TARGET ? 'pass (over the target; consider splitting)' : 'pass';
  const where = label === 'HEAD' ? '' : ` [${label}]`;
  console.log(`pr-size${where}: ${s.total} changed lines (+${s.added}/-${s.deleted}) in ${s.files} files; ${s.skipped.length} excluded. Limit ${LIMIT}, target ${TARGET}: ${verdict}`);
  if (s.binaries.length) console.log(`pr-size: binary files are not line-counted; justify them in the PR: ${s.binaries.map((b) => b.path).join(', ')}`);
  if (s.total <= LIMIT) return 0;
  const reason = exceptionReason(process.env);
  if (reason) {
    console.log(`pr-size: size exception accepted: ${reason}`);
    return 0;
  }
  console.error('pr-size: split this into stacked PRs, or add the size-exception label and a "Size exception: <reason>" line.');
  return 1;
}

function main(argv) {
  const i = argv.indexOf('--base');
  const base = i === -1 ? process.env.BASE_SHA || 'origin/main' : argv[i + 1];
  if (!base || base.startsWith('--')) {
    console.error('pr-size: usage: node scripts/check/pr-size.mjs [--base <ref>] [--stdin-refs]');
    return 2;
  }
  if (!resolves(base)) {
    // Usually the first push of a new repo. One line, and the hook reports it as blocked.
    console.error(`pr-size: ${base} does not exist yet, so there is nothing to compare against. Run "git fetch" if it should.`);
    return 2;
  }
  // --stdin-refs: the pre-push hook passes the refs being pushed, which need not be HEAD.
  let tips = [];
  if (argv.includes('--stdin-refs') && !process.stdin.isTTY) {
    try { tips = pushedTips(readFileSync(0, 'utf8')); } catch { tips = []; }
  }
  if (tips.length === 0) tips = [{ ref: 'HEAD', sha: process.env.HEAD_SHA || 'HEAD' }];
  const codes = tips.map((t) => checkRange(base, t.sha, t.ref));
  return codes.includes(1) ? 1 : codes.includes(2) ? 2 : 0;
}

// Case-insensitive compare: on Windows the drive letter case can differ.
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main(process.argv.slice(2));
}
