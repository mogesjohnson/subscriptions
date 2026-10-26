// BEST-OF-AI-DEV template v1. Commit message rules, shared by the commit-msg hook and CI.
// Format: Conventional Commits. "type(scope)!: subject", at most 72 characters.
// Type and scope are lowercase: "fix(api/auth): ...", not "Fix(API): ...".
// Link issues with a "Refs: #12" footer. Closing keywords are banned: issues close on
// human acceptance, not on merge (RULES.md R7).

export const TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'perf', 'build', 'ci', 'chore', 'revert', 'style'];
export const MAX_SUBJECT = 72;

const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: \\S`);
// Local hook: git's own merge, revert and autosquash subjects are fine while you work.
export const EXEMPT = /^(Merge |Revert "|fixup! |squash! |amend! )/;
// PR gate: only reverts. A fixup! or "Merge ..." commit reaching main means history
// was not cleaned up (real merge commits are excluded by --no-merges, not by subject).
export const PR_EXEMPT = /^Revert "/;
// "closes #12", "Fixed owner/repo#3", "resolves https://github.com/o/r/issues/4"
export const CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b:?\s+(#\d+|[\w.-]+\/[\w.-]+#\d+|https?:\/\/\S+\/issues\/\d+)/i;
const SCISSORS = /^# -+ >8 -+$/;

/**
 * Removes git comment lines and everything below the scissors line.
 * Git's own comments are "# text" or a bare "#", so only those are dropped. A line like
 * "#12 add x" (from `git commit -m`, which keeps it) stays and fails the format check
 * with a real reason instead of vanishing. A leading BOM is removed: Windows
 * PowerShell 5.1 writes one with `-Encoding UTF8` (`Set-Content`, `Out-File`), and so do
 * some editors.
 */
export function cleanMessage(raw, commentChar = '#') {
  const lines = [];
  const c = commentChar && commentChar !== 'auto' ? commentChar : '#';
  for (const line of raw.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')) {
    if (SCISSORS.test(line)) break;
    if (line === c || line.startsWith(`${c} `) || line.startsWith(`${c}\t`)) continue;
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  while (lines.length && lines[0].trim() === '') lines.shift();
  return lines;
}

/** Returns a list of problems; empty means the subject is valid. */
export function checkSubject(subject, exempt = EXEMPT) {
  if (exempt.test(subject)) return [];
  const problems = [];
  if (!SUBJECT.test(subject)) {
    if (SUBJECT.test(subject.replace(/^[^:]*/, (head) => head.toLowerCase()))) {
      problems.push('type and scope must be lowercase, e.g. "fix(api): ..."');
    } else if (/^#\d+\b/.test(subject)) {
      problems.push('subject must start with the type, not the issue number: "fix(x): summary", then a "Refs: #N" footer');
    } else {
      problems.push(`subject must look like "type(scope): summary" with type one of: ${TYPES.join(', ')}`);
    }
  }
  if (subject.length > MAX_SUBJECT) problems.push(`subject is ${subject.length} characters; the limit is ${MAX_SUBJECT}`);
  if (/\.\s*$/.test(subject)) problems.push('subject must not end with a period');
  if (CLOSING.test(subject)) problems.push('no closing keywords (closes/fixes/resolves #N); use a "Refs: #N" footer');
  return problems;
}

/** Checks a whole commit message as git writes it to COMMIT_EDITMSG. */
export function checkMessage(raw, commentChar = '#', exempt = EXEMPT) {
  const lines = cleanMessage(raw, commentChar);
  if (lines.length === 0) return ['empty commit message'];
  const [subject, second, ...body] = lines;
  if (exempt.test(subject)) return [];
  const problems = checkSubject(subject, exempt);
  if (second !== undefined && second.trim() !== '') problems.push('leave one blank line between the subject and the body');
  if (body.some((l) => CLOSING.test(l))) problems.push('no closing keywords in the body; use a "Refs: #N" footer');
  return problems;
}
