// BEST-OF-AI-DEV template v1. Environment hygiene for anything that spawns git.
//
// Git exports GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and friends to hooks. A hook in a
// linked worktree gets GIT_DIR pointing at that worktree. Any child that runs git
// somewhere else (a test's throwaway repo, a build step) silently operates on the REAL
// repo instead: "git init" + "git config" set core.bare and user.name on it, and
// "git switch" moves the worktree. Strip them for every child that does not need them.
// This also drops GIT_SSH_COMMAND, GIT_ASKPASS and GIT_CONFIG_*; a check that needs
// them must set them itself or be marked gitEnv: true in hooks/run-checks.mjs.

/** A copy of env without any GIT_* variable. */
export function withoutGitEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^GIT_/i.test(k)) out[k] = v;
  }
  return out;
}
