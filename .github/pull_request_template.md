<!-- Title: Conventional Commits, for example "feat(api): add retry budget". At most 72 characters.
     No closing keywords anywhere (closes, fixes, resolves). Issues close on human acceptance. -->

## Summary

<!-- One to three sentences: the problem, and the behavior after this PR. -->

Tracking: <!-- #123, a task spec path such as docs/tasks/0007-retry.md, or "none" -->

## Validation

<!-- One line per check: status, then the exact command or evidence.
     Status is pass, fail, blocked or not_run. A CI run blocked by billing is "blocked". -->

- <!-- pass: `npm test` -->
- <!-- not_run: e2e, because ... -->

## Size

<!-- Paste the output line of `node scripts/check/pr-size.mjs`.
     Over 600 lines needs the size-exception label and a "Size exception:" line here. -->

## Review checklist

- [ ] Scope matches the task spec; follow-ups are listed, not done.
- [ ] Every acceptance criterion has a test or a recorded check.
- [ ] Docs that describe the changed behavior are updated.
- [ ] No secrets, `.env*`, personal paths or raw transcripts are in the diff.
- [ ] No new dependency, CI change or auth/billing change without owner approval.
- [ ] Nothing left running; my worktree will be removed after merge.

<!-- Untick anything you did not check, and say why on the same line. -->

## Risks and follow-ups

<!-- What could break, what you did not do, and what should come next. Write "none" if none. -->
