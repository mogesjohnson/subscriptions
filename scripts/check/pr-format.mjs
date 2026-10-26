#!/usr/bin/env node
// BEST-OF-AI-DEV template v1. Checks a PR's title, body and every commit message in it.
//
//   PR_TITLE=... PR_BODY=... [PR_AUTHOR=...] node scripts/check/pr-format.mjs [--base <ref>]
//
// Skipped for Dependabot (PR_AUTHOR dependabot[bot]): its titles and bodies are generated.
// A GitHub revert PR skips the body check, but only when all three hold: the title is
// 'Revert "..."', the whole body is "Reverts <this repo>#N", and every commit is a git
// revert ('Revert "..."' with "This reverts commit <sha>."). The named sha must be on the
// base branch, and the revert's diff must be the exact inverse of that commit's diff. A
// hand-written PR that only copies the title, body and message still gets the full check.
// Commits are checked strictly: fixup!, squash! and "Merge ..." subjects fail here.
//
// CI passes the title and body through env vars, never by pasting them into a shell line.
// Locally, omit PR_TITLE and PR_BODY to check only the commits. Exit 0 pass, 1 fail, 2 error.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMessage, checkSubject, CLOSING, PR_EXEMPT } from './commit-format.mjs';

export const SECTIONS = ['Summary', 'Validation', 'Size', 'Review checklist', 'Risks and follow-ups'];
const STATUS_LINE = /^\s*[-*]\s*(pass|fail|blocked|not_run)\b/m;
const EMPTY_STATUS = /^\s*[-*]\s*(pass|fail|blocked|not_run)\s*:?\s*$/m;
// Sections that must say something once comments are removed ("none" counts).
const NEEDS_TEXT = ['Summary', 'Size', 'Risks and follow-ups'];
export const DEPENDABOT = 'dependabot[bot]';
export const REVERT_BODY = /^Reverts ([\w.-]+\/[\w.-]+)#\d+$/;
// A reverted merge commit adds ", reversing changes made to <first parent>".
export const REVERT_COMMIT = /^Revert "[^\n]*"\n(?:[\s\S]*\n)?This reverts commit ([0-9a-f]{64}|[0-9a-f]{40})(?:, reversing\s+changes made to (?:[0-9a-f]{64}|[0-9a-f]{40}))?\./;

/**
 * True only for a PR GitHub's Revert button could have made. `verify(commit, revertedSha)`
 * checks the commit against git (see revertsBaseCommit); main() always passes it.
 */
export function isRevertPr(title, body, commits, repo, verify = () => true) {
  const m = REVERT_BODY.exec((body || '').replace(/\r/g, '').trim());
  if (title === undefined || !PR_EXEMPT.test(title) || !m) return false;
  if (repo && m[1].toLowerCase() !== repo.toLowerCase()) return false;
  return commits.length > 0 && commits.every((c) => {
    const r = REVERT_COMMIT.exec(c.message.replace(/\r/g, ''));
    return Boolean(r) && verify(c, r[1]);
  });
}

function gitOut(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

/** The reverted commit is on `base`, and `commit` undoes exactly its diff (first parent). */
export function revertsBaseCommit(base, commit, reverted) {
  if (gitOut(['merge-base', '--is-ancestor', reverted, base]) === null) return false;
  const undo = gitOut(['diff', '--full-index', '--binary', reverted, `${reverted}^`]);
  const done = gitOut(['diff', '--full-index', '--binary', `${commit.sha}^`, commit.sha]);
  return undo !== null && undo !== '' && undo === done;
}

function section(text, name) {
  return (text.split(new RegExp(`^##\\s+${name}\\s*$`, 'mi'))[1] || '').split(/^##\s/m)[0];
}

export function checkBody(body) {
  const text = body.replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // Quoted examples in code are not links; GitHub does not act on them either.
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const problems = [];
  for (const s of SECTIONS) if (!new RegExp(`^##\\s+${s}\\s*$`, 'mi').test(text)) problems.push(`body is missing the "## ${s}" section`);
  if (!/^Tracking:[ \t]*\S/m.test(text)) problems.push('body needs a "Tracking:" line (an issue, a task spec path, or "none")');
  const validation = section(text, 'Validation');
  if (!STATUS_LINE.test(validation)) problems.push('Validation needs at least one "- pass|fail|blocked|not_run: ..." line');
  if (EMPTY_STATUS.test(validation)) problems.push('a Validation line has a status but no command or evidence');
  for (const s of NEEDS_TEXT) {
    const content = section(text, s).replace(/^Tracking:.*$/m, '').trim();
    if (new RegExp(`^##\\s+${s}\\s*$`, 'mi').test(text) && !content) problems.push(`"## ${s}" is still the template placeholder; fill it in`);
  }
  if (CLOSING.test(prose)) problems.push('body uses a closing keyword; write "Refs: #N" so the issue stays open until accepted');
  return problems;
}

/** Splits `git log --format=%H%x00%B%x1e` output into [{ sha, message }]. */
export function parseLog(out) {
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter((r) => r.includes('\0')).map((r) => {
    const [sha, message] = r.split('\0');
    return { sha: sha.trim(), message };
  });
}

function main(argv) {
  const i = argv.indexOf('--base');
  const base = i === -1 ? process.env.BASE_SHA || 'origin/main' : argv[i + 1];
  if (!base || base.startsWith('--')) {
    console.error('usage: pr-format.mjs [--base <ref>]  (PR_TITLE, PR_BODY, BASE_SHA, HEAD_SHA from env)');
    return 2;
  }
  if (process.env.PR_AUTHOR === DEPENDABOT) {
    console.log('pr-format: skipped (Dependabot writes its own title, body and commits)');
    return 0;
  }
  const problems = [];
  const title = process.env.PR_TITLE;
  const body = process.env.PR_BODY;
  if (title !== undefined) problems.push(...checkSubject(title, PR_EXEMPT).map((p) => `title: ${p}`));
  let commits;
  try {
    commits = parseLog(execFileSync('git', ['log', '--no-merges', '--format=%H%x00%B%x1e', `${base}..${process.env.HEAD_SHA || 'HEAD'}`], { encoding: 'utf8' }));
  } catch (err) {
    console.error(`pr-format: cannot read commits since ${base}. Fetch it first. (${err.message.split('\n')[0]})`);
    return 2;
  }
  const revert = isRevertPr(title, body, commits, process.env.GITHUB_REPOSITORY, (c, sha) => revertsBaseCommit(base, c, sha));
  if (body !== undefined && !revert) problems.push(...checkBody(body));
  for (const c of commits) problems.push(...checkMessage(c.message, '#', PR_EXEMPT).map((p) => `commit ${c.sha.slice(0, 7)}: ${p}`));
  if (problems.length) {
    console.error(`pr-format: fail (${problems.length})`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`pr-format: pass (${commits.length} commits${process.env.PR_BODY !== undefined ? ', title and body' : ''})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main(process.argv.slice(2));
}
